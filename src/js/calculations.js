import Taxee from 'taxee-tax-statistics'
import { min, max, map, each, get, sum, groupBy } from 'lodash'

export function getTaxInfo(year, region, status, capitalGains = false) {
  const rawInfo = Taxee[year][region]
  const isFed = region == 'federal'
  const data = isFed ? rawInfo.tax_withholding_percentage_method_tables.annual[status] : rawInfo[status]
  const deduction = data.deductions[0].deduction_amount

  if (isFed && capitalGains) {
    var brackets = map(data.income_tax_brackets, (d) => {
      return { 'incomeLevel': d.bracket, 'marginalRate': d.marginal_capital_gain_rate / 100 }
    })
  } else {
    brackets = map(data.income_tax_brackets, (d) => {
      return { 'incomeLevel': d.bracket, 'marginalRate': d.marginal_rate / 100 }
    })
  }

  return [deduction, brackets]
}


export function calculateIncomeTaxes(filing, gains = null) {
  var f = filing

  var [standardStateDeduction, stateBrackets] = getTaxInfo(filing.year, f.filingState, f.filingStatus)
  var [standardFederalDeduction, federalBrackets] = getTaxInfo(filing.year, 'federal', f.filingStatus)

  // apply custom deductions if available
  var federalDeduction = get(f, "federalDeduction", standardFederalDeduction)
  var stateDeduction = get(f, "stateDeduction", standardStateDeduction)

  var agiDeductedFed = f.agi - federalDeduction
  var agiDeductedState = f.agi - stateDeduction

  var federal = applyTaxBrackets(agiDeductedFed, federalBrackets)
  var state = applyTaxBrackets(agiDeductedState, stateBrackets)

  if (gains != null) {
    var federalWithGains = applyTaxBrackets(agiDeductedFed + gains, federalBrackets)
    var stateWithGains = applyTaxBrackets(agiDeductedState + gains, stateBrackets)
    federal = federalWithGains - federal
    state = stateWithGains - state
  }
  return {
    'federal': federal,
    'state': state
  }
}

export function calculateCapitalGainsTaxes(filing, lifecycles) {
  const { year } = filing
  const sales = groupBy(lifecycles, (l) => { l.sale?.date?.year })[year]

  var [shorGains, longGains] = [0, 0]
  each(sales, (l) => {
    // ISO requirements to qualify for long term cap gains
    const dateDiff = l.sale.date.diff(l.option.date, 'days')
    const grantedTwoYearsAgo = l.sale.date.diff(l.option.date, 'days') >= 730
    const exercisedOnYearAgo = l.sale.date.diff(l.stock.date, 'days') >= 365
    const stockBasis = l.stock.price * l.stock.units
    const stockSale = l.sale.price * l.sale.units
    if (grantedTwoYearsAgo && exercisedOnYearAgo) {
      longGains += stockSale - stockBasis
    } else {
      shorGains += stockSale - stockBasis
    }
  })

  const taxes = calculateIncomeTaxes(year, shorGains)
  const capGainsInfo = getTaxInfo(year, 'federal', filing.filingStatus, true)
  taxes.capitalGains = applyTaxBrackets(longGains, capGainsInfo[1])

  return taxes
}

export function calculateAmtTaxes(filing, lifecycles) {
  const { year } = filing
  const amtExemption = 72_900
  const amtTaxRate = 0.26

  const sales = groupBy(lifecycles, (l) => { l.stock?.date?.year })[year]
  const exercised = map(sales, (l) => { if (l.stock !== undefined) return l })
  const exerciseSpread = sum(map(exercised, (l) => {
    return (l.stock.fmv * l.stock.units) - (l.option.units * l.option.price)
  }))

  const amBase = filing.agi + exerciseSpread - amtExemption
  const tmt = amBase * amtTaxRate
  const incomeTaxes = calculateIncomeTaxes(year)
  const amtTax = max([0, tmt - incomeTaxes.federal])

  return max([0, amtTax])
}

export function applyTaxBrackets(income, brackets) {
  var taxes = 0
  each(brackets, (bracket, i) => {
    if (income == 0) {
      return
    }
    // if we have yet to hit the last bracket
    if (i < brackets.length - 1) {
      var nextBracketIncome = brackets[i + 1].incomeLevel
      var incomeLevelBand = nextBracketIncome - bracket.incomeLevel
      var portion = min([income, incomeLevelBand])
      // otherwise the rest of the income will be taxed at this last bracket
    } else {
      portion = income
    }
    taxes += portion * bracket['marginalRate']
    income -= portion
  })
  // if there is income left over after exhausting all brackets
  // tax remainder at highest bracket
  if (income) {
    taxes += income * brackets[-1].marginalRate
  }
  return max([0, taxes])
}