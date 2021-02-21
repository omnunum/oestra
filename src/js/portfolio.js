import { reactive } from 'vue'
import { DateTime, Duration } from 'luxon'

import { Asset, Lifecycle, Event, Filing, Actions } from './classes'


export class Portfolio {
  constructor(initialCash = 0) {
    this.cash = initialCash
    this._filings = reactive({})
    this._events = reactive([])
    this._lifecycles = reactive([])
  }

  get filings() { return this._filings }

  get events() {
    return this._events.sort((a, b) => a.date - b.date)
  }

  get lifecycles() {
    return this._lifecycles.sort((a, b) => a.date - b.date)
  }

  updateFiling(year, filing) {
    filing = reactive(new Filing({
      "grossIncome": 0,
      "withholdings": 0,
      "filingState": undefined,
      "filingStatus": undefined,
      ...filing
    }))

    console.log(`updated ${year} to`, filing)
    this._filings[year] = filing
    console.log(this._filings)
  }

  grantOption(ticker, price, units, date) {
    var event = new Event({ action: Actions.optionGrant, ticker, price, units, date })
    this._events.push(event)
    var option = new Asset({ price, units, date })
    var lifecycle = new Lifecycle({ ticker, option, date })
    this._lifecycles.push(lifecycle)
  }

  grantOptionsFromSchedule(ticker, price, units, beginDate, cliffDate, cutoffDate = DateTime.utc(), numMonths = 48) {
    if (cliffDate) {
      if (cutoffDate < cliffDate) { return null }
      else if (cliffDate != beginDate) {
        let fromYear = (cliffDate.year - beginDate.year) * 12
        let fromMonths = (cliffDate.month - beginDate.month)
        let monthsVestedAtCliff = fromYear + fromMonths
        let cliffUnits = Math.floor((units / numMonths) * monthsVestedAtCliff)
        this.grantOption(ticker, price, cliffUnits, cliffDate)

        units -= cliffUnits
        numMonths -= monthsVestedAtCliff
        beginDate = cliffDate
      }
    }
    var rawChunkSize = ~~(units / numMonths)
    var remainder = units % numMonths

    for (var i = 0; i < numMonths; i++) {
      // "consume" from the remainder while it exists
      let chunkSize = i > remainder ? rawChunkSize + 1 : rawChunkSize
      let chunkDate = beginDate.plus(Duration.fromObject({ months: i }))

      // we can't get grants until the cliff (if it exists) is over
      let beyondCliff = (cliffDate === undefined || chunkDate >= cliffDate)
      // we want to add chunks up until this point in time unless
      // the cutoff date is manually set into the future
      let notCutOff = (cutoffDate === undefined || chunkDate <= cutoffDate)
      if (beyondCliff && notCutOff) {
        this.grantOption(ticker, price, chunkSize, chunkDate)
      }
    }

  }

  evolveAssets(action, ticker, units, date = null, price = null, fmv = null, optimize = 'date') {
    date = date || DateTime.utc()

    switch (action) {
      case Actions.stockSale:
        var [source, destination] = ['stock', 'sale']
        break
      case Actions.optionExercise:
        [source, destination] = ['option', 'stock']
        break
    }

    var evolvable = []
    for (const [i, l] of this._lifecycles.entries()) {
      if (l.ticker == ticker && l[destination] == undefined && l[source] != undefined) {
        evolvable.push([i, l])
      }
    }

    switch (optimize) {
      case 'date':
        evolvable = evolvable.sort((a, b) => a[1][source].date - b[1][source].date)
        break
      case 'price':
        evolvable = evolvable.sort((a, b) => b[1][source].price - a[1][source].price)
        break
    }

    for (var [i, l] of evolvable) {
      var s = l[source]
      // if the current cycle can be evolved whole
      if (s.units <= units) {
        this._lifecycles[i][destination] = new Asset({ price: s.price, units: s.units, date, fmv })
        this._lifecycles[i].date = date
        units -= s.units
        // if the current cycle cant be evolved whole, split 
        // into two and evolve just one of them
      } else {
        l.date = date
        const [resized, remainder] = l.split(units)
        this._lifecycles.push(remainder)

        const destinationPrice = action == Actions.stockSale ? price : s.price
        resized[destination] = new Asset({ price: destinationPrice, units, date, fmv })
        this._lifecycles[i] = resized
        units = 0
      }
      this._events.push(new Event({ action, ticker, price: s.price, units: s.units, date, fmv }))
      // leave loop if we've exhausted all units
      if (!units) { break }
    }
  }
}
