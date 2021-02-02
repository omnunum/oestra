import { DateTime, Duration } from 'luxon';
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')



let Asset = class {
    constructor(price, units, date, fmv) {
        this.price = price;
        this.units = units;
        this.date = date;
        this.fmv = fmv;
    }
};

let Lifecycle = class {
    constructor(ticker, option, stock, sale) {
        this.ticker = ticker;
        this.option = option;
        this.stock = stock;
        this.sale = sale;
    }
};

let Event = class {
    constructor(action, ticker, price, units, date, fmv) {
        this.action = action;
        this.ticker = ticker;
        this.price = price;
        this.units = units;
        this.date = date;
        this.fmv = fmv;
    }
};

let Portfolio = class {
    constructor(filings, initial_cash) {
        this.cash = initial_cash

        Object.values(filings).forEach(
            (filing) => filing.agi = (filing.gross_income - filing.withholdings || 0)
        )
        this.filings = filings;
        this._events = [];
        this.lifecycles = [];
    }

    get events() {
        return this._events.sort((a, b) => a.date - b.date);
    }

    grant_option(ticker, price, units, date) {
        var event = new Event('grant option', ticker, price, units, date);
        this._events.push(event);
        var option = new Asset(price, units, date);
        var lifecycle = new Lifecycle(ticker, option);
        this.lifecycles.push(lifecycle);
    }

    grant_options_from_schedule(ticker, price, units, begin_date, cliff_date, cutoff_date, num_months=48) {
        if (cliff_date) {
            if (cutoff_date < cliff_date) { return null; }
            else if (cliff_date != begin_date) {
                let from_year = (cliff_date.year - begin_date.year) * 12;
                let from_months = (cliff_date.month - begin_date.month);
                let months_vested_at_cliff = from_year + from_months;
                let cliff_units = Math.floor((units / num_months) * months_vested_at_cliff);
                this.grant_option(ticker, price, cliff_units, cliff_date);
                
                units -= cliff_units;
                num_months -= months_vested_at_cliff;
                begin_date = cliff_date;
            }
            var raw_chunk_size = ~~(units/num_months);
            var remainder = units % num_months;
            var i;
            for (i = 0; i < num_months; i++) {
                // "consume" from the remainder while it exists
                let chunk_size = i > remainder ? raw_chunk_size + 1 : raw_chunk_size;
                let chunk_date = begin_date.plus(Duration.fromObject({months: i}));
                
                // we can't get grants until the cliff (if it exists) is over
                let beyond_cliff = (cliff_date === undefined || chunk_date >= cliff_date);
                // we want to add chunks up until this point in time unless
                // the cutoff date is manually set into the future
                let not_cut_off = (cutoff_date === undefined || chunk_date <= cutoff_date);
                if (beyond_cliff && not_cut_off) {
                    this.grant_option(ticker, price, chunk_size, chunk_date) ;   
                }
            }
        }
    }


};

var filings = {
    2019: {
        "gross_income": 126_730.64,
        "withholdings": (6_000 + 2_395.91 + 23),
        "filing_state": "georgia",
        "filing_status": "single",
        "federal_deduction": null,
        "state_deduction": null
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
};

var p = new Portfolio(filings, 13_000);
p.grant_options_from_schedule('JEFF', 2.18, 8000, DateTime.utc(2019, 1, 30), DateTime.utc(2020, 1, 30));
p.grant_options_from_schedule('JEFF', 3.08, 5000, DateTime.utc(2020, 6, 1), null);
console.log(p._events);