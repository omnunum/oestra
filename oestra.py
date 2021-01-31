from collections import defaultdict
from dataclasses import dataclass, asdict
from datetime import timedelta
from typing import List, Union, Optional
from tempfile import NamedTemporaryFile
import arrow
from arrow import Arrow
import pandas as pd
import sqlite3
import logging 
import requests as rq
from typing import List, Tuple


@dataclass
class Asset:
    price: float
    units: int
    date: Arrow
    fmv: Optional[int] = None

@dataclass
class Lifecycle: 
    ticker: str
    option: Asset
    stock: Optional[Asset] = None
    sold: Optional[bool] = None

@dataclass
class Event:
    action: str
    ticker: str
    price: float
    units: int
    date: Arrow


class Portfolio:
    def __init__(self, region: str, filing_status: str, initial_cash: Optional[float] = None):
        self.cash = initial_cash
        self.region = region
        self.filing_status = filing_status
        self._events = []
        self.fifo = []
        self.lifo = []
        
    @property
    def events(self):
        return sorted(p.events, key=lambda x: x.date)

    def cost_basis(self, category: str, ticker: str) -> float:
        assets = self.query(category=category, ticker=ticker)
        
        return (self.assets.price * self.assets.units).sum()
    
    def total_amount(self, category: str, ticker: str) -> int:
        assets = self.query(category=category, ticker=ticker)
        
        return self.assets.units.sum()
    
    def grant_option(self, ticker: str, price: float, units: int, date: Arrow) -> Event:
        event = Event('grant option', ticker, price, units, date)
        self._events.append(event)
        option = Asset(price, units, date)
        lifecycle = Lifecycle(ticker, option)
        self.fifo.append(lifecycle)
        self.lifo.insert(0, lifecycle)
        
        return event
    
    def exercise_options(self, ticker: str, price: float, units: int, date: Arrow, fmv: float) -> Event:
        event = Event('option exercise', ticker, price, units, date)
        self._upsert_event(event)
        a = self.query('assets', category='option', ticker=ticker)

        o = a[a.price == price].units.cumsum().reset_index()
        # index of first unit that brings the cumsum over the amount we want to exercise
        over_target_ix = o[o.units >= units].iloc[0].name
        # get the original `p.assets` indeces of all the target units
        target_grants = o.iloc[0:over_target_ix + 1]
        # subtract the units to exercise from the cumulative amount to get the 
        # remainder we want to replace as the value of the last grant in our set
        remainder = target_grants.iloc[-1].units - units
        
        grant_to_update_ix = target_grants['_ID'].iloc[-1]
        grant_to_update = a.iloc[grant_to_update_ix]
        partial_grant = Asset(**grant_to_update.to_dict())
        partial_grant.units = remainder

        self._remove_assets(target_grants['_ID'].iloc[:-1].tolist())
        self._upsert_asset(partial_grant, _id=grant_to_update_ix)
        
        stock = Asset('stock', ticker, price, units, date, fmv)
        self._upsert_asset(stock)
        
        return event

    def grant_options_from_schedule(self, 
                                    ticker: str, 
                                    price: float, 
                                    units: int, 
                                    begin_date: Arrow, 
                                    cliff_date: Arrow,
                                    cutoff_date=Arrow.utcnow(),
                                    num_months=48):
        raw_chunk_size, remainder = divmod(units, num_months)
        amount_to_grant = 0
        for i in range(num_months):
            # "consume" from the remainder while it exists
            chunk_size = raw_chunk_size + 1 if i < remainder else raw_chunk_size
            amount_to_grant += chunk_size
            
            # get date at this chunk of options
            year_delta, month_delta = divmod(i, 12)
            chunk_year = begin_date.year + year_delta
            chunk_month = begin_date.month + month_delta

            # roll chunk month into year if greater than 12
            year_roll, chunk_month = divmod(chunk_month, 12)
            chunk_year += year_roll
            
            chunk_date = Arrow(chunk_year, chunk_month + 1, begin_date.day)
            
            # we can't get grants until the cliff (if it exists) is over
            beyond_cliff = cliff_date is None or chunk_date >= cliff_date
            # we want to add chunks up until this point in time unless
            # the cutoff date is manually set into the future
            not_cut_off = cutoff_date is None or chunk_date <= cutoff_date
            if beyond_cliff and not_cut_off:
                self.grant_option(ticker, price, amount_to_grant, chunk_date)
                amount_to_grant = 0            
        
        
    def get_tax_info(self, capital_gains=False) -> (int, list):
        """Fetch tax brackets and deduction amount for a region of the US for FY2020 
        :param region: Can be any of the 50 states, `district of columbia`, or `federal`
        :param filing_status: Options are (single, married, married_separately, head_of_household)
        :param capital_gains: Whether you want to return capital gains rates instead of income
        """
        if capital_gains and self.region != 'federal':
            raise ValueError("Can only apply capital gains rate to `federal` region")

        normalized_region = region.lower().replace(' ', '_')
        url = (f"https://raw.githubusercontent.com/taxee/taxee-tax-statistics"
               f"/master/src/statistics/2020/{normalized_region}.json")
        res = rq.get(url)
        try:
            res.raise_for_status()
        except rq.RequestException as e:
            raise ValueError(f"'{self.region}' is not a valid region")
        if region == 'federal':
            data = res.json()['tax_withholding_percentage_method_tables']['annual'][self.filing_status]
        else:
            data = res.json()[self.filing_status]
        deduction = data['deductions'][0]['deduction_amount']
        rate_key = 'marginal_capital_gain_rate' if capital_gains else 'marginal_rate'
        brackets = data['income_tax_brackets']
        brackets = [
            {'income_level': d['bracket'], 'marginal_rate': d[rate_key] / 100.0} 
            for d in brackets
        ]
        
        return deduction, brackets
    
    def taxes(self, income: float, brackets: List[dict]) -> float:
        """Calculate taxes owed based on progressive bracket"""
        taxes = 0
        for i, bracket in enumerate(brackets):
            if income == 0:
                break
            # if we have yet to hit the last bracket
            if i < len(brackets) - 1:
                next_bracket_income = brackets[i + 1]['income_level']
                income_level_band = next_bracket_income - bracket['income_level']
                portion = min(income, income_level_band)
            # otherwise the rest of the income will be taxed at this last bracket
            else:
                portion = income
            taxes += portion * bracket['marginal_rate']
            income -= portion

        # if there is income left over after exhausting all brackets
        # tax remainder at highest bracket
        if income:
            taxes += income * brackets[-1]['marginal_rate']
            
        return taxes

    def calculate_payroll_tax(self, income: float) -> float:
        social_security_bracket = [{'income_level': 142_800, 'marginal_rate': 0.062}]
        medicare_rate = 0.0145
        
        social_security_tax = taxes(income, social_security_bracket)
        medicare_tax = gross_income * medicare_rate
        payroll_tax = social_security_tax + medicare_tax
        
        return payroll_tax
    
    def calculate_income_taxes(
        income: float, 
        filing_state: str, 
        filing_status='single', 
        federal_deduction=None, 
        state_deduction=None,
    ) -> dict:
        standard_state_deduction, state_income_brackets = get_tax_info(filing_state, filing_status)
        standard_federal_deduction, federal_income_brackets = get_tax_info('federal', filing_status)

        # apply custom deductions if available
        federal_deduction = federal_deduction or standard_federal_deduction
        state_deduction = state_deduction or standard_federal_deduction

        federal_income_tax = taxes(income - federal_deduction, federal_income_brackets) 
        state_income_tax = taxes(income - state_deduction, state_income_brackets) 

        return {
            'federal': federal_income_tax, 
            'state': state_income_tax, 
        }
    
    def calculate_amt_taxes(income: float, options: Tuple[float, int]) -> float:
        amt_exemption = 72_900
        cost_basis = sum(o[0] * o[1] for o in options)
        number_of_options = sum(o[1] for o in options)
        avg_price_per_share = cost_basis / number_of_options
        valuation_at_exercise = number_of_options * fmv

        exercise_spread = valuation_at_exercise - cost_basis
        amt_base = agi + exercise_spread - amt_exemption
        amt_tax_rate = 0.26
        tmt = amt_base * amt_tax_rate
        amt_tax = max(0, tmt - income_taxes['federal'])

        return amt_tax

    def calculate_capital_gains_taxes(self,
        income: float,
        year=None
        ) -> float:
        cost_basis = sum(o[0] * o[1] for o in options)
        number_of_options = sum(o[1] for o in options)

        valuation_at_sale = number_of_options * target_price
        gains_from_sale = valuation_at_sale - cost_basis
        _, cap_gains_brackets = get_tax_info('federal', 'single', capital_gains=True)
        cap_gains_tax = taxes(gains_from_sale, cap_gains_brackets)