import { cloneDeep } from 'lodash'

export const Actions = {
  optionGrant: "option grant",
  optionExercise: "option exercise",
  stockSale: "stock sale",
}

Object.freeze(Actions)

export class Asset {
  constructor({ price, units, date, fmv = undefined }) {
    this.price = price
    this.units = units
    this.date = date
    this.fmv = fmv
  }
}

export class Lifecycle {
  constructor({ ticker, option, stock = undefined, sale = undefined, date }) {
    this.ticker = ticker
    this.option = option
    this.stock = stock
    this.sale = sale
    this.date = date
  }

  split(units) {
    units = +units
    // part to leave unsold
    const resized = cloneDeep(this)
    const remainder = cloneDeep(this)
    const baseUnits = this.option.units
    resized.option.units = units
    remainder.option.units = baseUnits - units
    if (this.stock) {
      resized.stock.units = units
      remainder.stock.units = baseUnits - units
    }
    return [resized, remainder]
  }
}

export class Event {
  constructor({ action, ticker, price, units, date, fmv = undefined }) {
    this.action = action
    this.ticker = ticker
    this.price = price
    this.units = units
    this.date = date
    this.fmv = fmv
  }
}

export class Filing {
  constructor({ year, grossIncome, withholdings, filingState, filingStatus, federalDeduction, stateDeduction }) {
    this.year = year
    this.grossIncome = grossIncome
    this.withholdings = withholdings
    this.filingState = filingState
    this.filingStatus = filingStatus
    this.federalDeduction = federalDeduction
    this.stateDeduction = stateDeduction
  }

  get agi() { return this.grossIncome = this.withholdings }
}