from copy import deepcopy
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
    sale: Optional[Asset] = None

@dataclass
class Event:
    action: str
    ticker: str
    price: float
    units: int
    date: Arrow
    fmv: Optional[float] = None


class Portfolio:
    def __init__(self, filings, initial_cash: Optional[float] = None):
        self.cash = initial_cash
        
        # create adjusted gross income with any provided withholdings
        for year in filings.values():
            year['agi'] = year['gross_income'] - year.get('withholdings', 0)
            
        self.filings = filings
        self._events = []
        self.lifecycles = []
        
    @property
    def events(self):
        return sorted(self._events, key=lambda x: x.date)
            
    def grant_option(self, ticker: str, price: float, units: int, date: Arrow) -> None:
        event = Event('grant option', ticker, price, units, date)
        self._events.append(event)
        option = Asset(price, units, date)
        lifecycle = Lifecycle(ticker, option)
        self.lifecycles.append(lifecycle)


    def split_lifecycle(self, l: Lifecycle, units: int) -> (Lifecycle, Lifecycle):
        # part to leave unsold
        resized, remainder = deepcopy(l), deepcopy(l)
        base_units = l.option.units
        resized.option.units = units
        remainder.option.units = base_units - units
        if l.stock is not None:
            resized.stock.units = units
            remainder.stock.units = base_units - units

        return resized, remainder


    def evolve_asset(self,
        event: str,
        ticker: str, 
        units: int, 
        date: Optional[Arrow] = None, 
        fmv: Optional[float] = None,
        price: Optional[float] = None,
        optimize: Optional[str] = 'date',
    ) -> None:
        date = date or Arrow.utcnow()
        
        if event == 'sell stocks':
            source, destination = 'stock', 'sale'
        elif event == 'exercise options':
            source, destination = 'option', 'stock'
        else:
            raise ValueError(f"{event} is not a valid event")
            
        evolvable = [
            (i, l) for i, l in enumerate(self.lifecycles) 
            if l.ticker == ticker
            and getattr(l, destination) is None
            and getattr(l, source) is not None
        ]
        
        if optimize == 'date':
            evolvable = sorted(evolvable, key=lambda x: getattr(x[1], source).date)
        elif optimize == 'price':
            evolvable = sorted(evolvable, key=lambda x: getattr(x[1], source).price, reverse=True)
        
        for i, l in evolvable: 
            s = getattr(l, source)
            # if the current option grant can be exercised in whole
            if s.units <= units:
                setattr(self.lifecycles[i], destination, Asset(s.price, s.units, date, fmv))
                units -= s.units
            # if the current stock cant be exercised whole, split lifecycle 
            # into two and exercise just one of them
            else:
                resized, remainder = self.split_lifecycle(l, units)
                self.lifecycles.insert(i + 1, remainder)
                
                destination_price = price if event == 'sell stocks' else s.price
                setattr(resized, destination, Asset(destination_price, units, date, fmv))
                self.lifecycles[i] = resized
                units = 0
            
            self._events.append(Event(event, ticker, s.price, s.units, date, fmv))
            # leave loop if we've exhausted all units
            if not units:
                break

    def add_months_to_date(self, months: int, begin_date: Arrow) -> Arrow:
        # get date at this chunk of options
        year_delta, month_delta = divmod(months, 12)
        target_year = begin_date.year + year_delta
        target_month = begin_date.month + month_delta

        # roll target month into year if greater than 12
        year_roll, target_month = divmod(target_month, 12)
        target_year += year_roll

        try:
            target_date = Arrow(target_year, target_month + 1, begin_date.day)
        except ValueError as e:
            if "day is out of range" in e.args[0]:
                first_of_month = Arrow(target_year, target_month + 1, 1)
                last_of_month = first_of_month.ceil('month').floor('day')
                target_date = last_of_month
            else: 
                print(target_year, target_month, begin_date.date)
                raise e
        return target_date
    
    def grant_options_from_schedule(self, 
                                    ticker: str, 
                                    price: float, 
                                    units: int, 
                                    begin_date: Arrow, 
                                    cliff_date: Arrow,
                                    cutoff_date=Arrow.utcnow(),
                                    num_months=48):
        # if cliff, vest the period all at once and reset parameters
        # to be based off the state at the cliff date
        if cliff_date:
            if cutoff_date < cliff_date:
                return
            elif cliff_date != begin_date:
                from_year = (cliff_date.year - begin_date.year) * 12
                from_months = (cliff_date.month - begin_date.month)
                months_vested_at_cliff = from_year + from_months
                cliff_units = int((units / num_months) * months_vested_at_cliff)
                self.grant_option(ticker, price, cliff_units, cliff_date)
                
                units -= cliff_units
                num_months -= months_vested_at_cliff
                begin_date = cliff_date
            
        raw_chunk_size, remainder = divmod(units, num_months)
        for i in range(num_months):
            # "consume" from the remainder while it exists
            chunk_size = raw_chunk_size + 1 if i > remainder else raw_chunk_size
            
            chunk_date = self.add_months_to_date(i, begin_date)
            
            # we can't get grants until the cliff (if it exists) is over
            beyond_cliff = cliff_date is None or chunk_date >= cliff_date
            # we want to add chunks up until this point in time unless
            # the cutoff date is manually set into the future
            not_cut_off = cutoff_date is None or chunk_date <= cutoff_date
            if beyond_cliff and not_cut_off:
                self.grant_option(ticker, price, chunk_size, chunk_date)
        
        
    def get_tax_info(self, year: int, region: str, status: str, capital_gains=False) -> (int, list):
        """Fetch tax brackets and deduction amount for a region of the US for FY2020 
        :param region: Can be any of the 50 states, `district of columbia`, or `federal`
        :param filing_status: Options are (single, married, married_separately, head_of_household)
        :param capital_gains: Whether you want to return capital gains rates instead of income
        """
        if capital_gains and region != 'federal':
            raise ValueError("Can only apply capital gains rate to `federal` region")

        normalized_region = region.lower().replace(' ', '_')
        year = min(year, 2020)
        url = (
            f"https://raw.githubusercontent.com/taxee/taxee-tax-statistics"
            f"/master/src/statistics/{year}/{normalized_region}.json"
        )
        res = rq.get(url)
        try:
            res.raise_for_status()
        except rq.RequestException as e:
            raise ValueError(f"'{region}' is not a valid region")
        if region == 'federal':
            data = res.json()['tax_withholding_percentage_method_tables']['annual'][status]
        else:
            data = res.json()[status]
        deduction = data['deductions'][0]['deduction_amount']
        rate_key = 'marginal_capital_gain_rate' if capital_gains else 'marginal_rate'
        brackets = data['income_tax_brackets']
        brackets = [
            {'income_level': d['bracket'], 'marginal_rate': d[rate_key] / 100.0} 
            for d in brackets
        ]
        
        return deduction, brackets
    
    def apply_tax_brackets(self, income: float, brackets: List[dict]) -> float:
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
            
        return max(0, taxes)

    def calculate_payroll_tax(self, year: int) -> float:
        social_security_bracket = [{
            'income_level': 142_800, 
             'marginal_rate': 0.062
        }]
        medicare_rate = 0.0145
        gross_income = self.filings[year]['gross_income']
        social_security_tax = self.apply_tax_brackets(gross_income, social_security_bracket)
        medicare_tax = gross_income * medicare_rate
        payroll_tax = social_security_tax + medicare_tax
        
        return payroll_tax
    
    def calculate_income_taxes(self, year: int, gains: Optional[float] = None) -> dict:
        f = self.filings[year]
        
        standard_state_deduction, state_brackets = self.get_tax_info(year, f['filing_state'], f['filing_status'])
        standard_federal_deduction, federal_brackets = self.get_tax_info(year, 'federal', f['filing_status'])

        # apply custom deductions if available
        federal_deduction = f.get("federal_deduction") or standard_federal_deduction
        state_deduction = f.get("state_deduction") or standard_federal_deduction

        agi_deducted_fed = f['agi'] - federal_deduction
        agi_deducted_state = f['agi'] - state_deduction
        
        federal = self.apply_tax_brackets(agi_deducted_fed, federal_brackets) 
        state = self.apply_tax_brackets(agi_deducted_state, state_brackets) 

        if gains is not None:
            federal_with_gains = self.apply_tax_brackets(agi_deducted_fed + gains, federal_brackets) 
            state_with_gains = self.apply_tax_brackets(agi_deducted_state + gains, state_brackets) 
            federal = federal_with_gains - federal
            state = state_with_gains - state

        return {
            'federal': federal,
            'state': state
        }
    
    def calculate_capital_gains_taxes(self, year: int) -> dict:
        f = self.filings[year]
        lifecycles = self.group_lifecycles(lambda x: x.sale.date.year)[year]
        short_gains, long_gains = 0, 0
        for l in lifecycles:
            # ISO requirements to qualify for long term cap gains
            granted_two_years_ago = (l.sale.date - l.option.date).days >= 730
            exercised_one_year_ago = (l.sale.date - l.stock.date).days >= 365
            stock_basis = l.stock.price * l.stock.units
            stock_sale = l.sale.price * l.sale.units
            if granted_two_years_ago and exercised_one_year_ago:
                long_gains += stock_sale - stock_basis
            else:
                short_gains += stock_sale - stock_basis

        taxes = self.calculate_income_taxes(year, short_gains)
        _, cap_gains_brackets = self.get_tax_info(year, 'federal', f['filing_status'], capital_gains=True)
        taxes['capital_gains'] = self.apply_tax_brackets(long_gains, cap_gains_brackets)
        
        return taxes
        
    def group_lifecycles(self, by: callable) -> dict:
        grouped = defaultdict(list)
        for l in self.lifecycles:
            try:
                grouped[by(l)].append(l)
            except AttributeError:
                continue
                
        return grouped
    
    def calculate_amt_taxes(self, year: int) -> float:
        amt_exemption = 72_900
        amt_tax_rate = 0.26
        
        lifecycles = self.group_lifecycles(lambda x: x.stock.date.year)[year]
        exercised = [l for l in lifecycles if l.stock is not None]
        exercise_spread = sum(
            (l.stock.fmv * l.stock.units) - (l.option.units * l.option.price) 
            for l in exercised
        )

        amt_base = self.filings[year]['agi'] + exercise_spread - amt_exemption
        tmt = amt_base * amt_tax_rate
        income_taxes = self.calculate_income_taxes(year)
        amt_tax = max(0, tmt - income_taxes['federal'])

        return max(0, amt_tax)


if __name__ == '__main__':
    target_price = 120

    filings = {
        2019: {
            "gross_income": 126_730.64,
            "withholdings": (6_000 + 2_395.91 + 23), # 401k, HSA, Dental
            "filing_state": "georgia",
            "filing_status": "single",
            "federal_deduction": None,
            "state_deduction": None
        }, 
        2020: {
            "gross_income": 127_200,
            "withholdings": (18_000 + 2_500 + 22),
            "filing_state": "georgia",
            "filing_status": "single"
        },
        2021: {
            "gross_income": 130_800,
            "withholdings": (18_000 + 2_500 + 22),
            "filing_state": "georgia",
            "filing_status": "single"
        }
    }
    p = Portfolio(filings, 13_000)
    p.grant_options_from_schedule('JEFF', 2.18, 8000, Arrow(2019, 1, 7), Arrow(2020, 1, 7))
    p.grant_options_from_schedule('JEFF', 3.08, 5000, Arrow(2020, 6, 1), None)
    p.evolve_asset('exercise options', 'JEFF', 2400, Arrow(2020, 12, 30), fmv=15)
    p.evolve_asset('exercise options', 'JEFF', 10000, Arrow(2021, 1, 31), fmv=16.57)
    # p.exercise_options('JEFF', 2400, Arrow(2020, 12, 30), 15)
    # p.exercise_options('JEFF', 10000, Arrow(2021, 1, 31), 16.57)
    p.evolve_asset('sell stocks', 'JEFF', 1000, price=50)
    print(p.calculate_amt_taxes(2021), p.calculate_capital_gains_taxes(2021))