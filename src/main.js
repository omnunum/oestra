import { cloneDeep, min, max, map, each, get, sum, groupBy, merge,  toPairs, flatMap} from 'lodash';
var superagent = require('superagent');
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
    constructor(ticker, option, stock, sale, date) {
        this.ticker = ticker;
        this.option = option;
        this.stock = stock;
        this.sale = sale;
        this.date = date;
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
    constructor(tax_info, filings, initial_cash) {
        this.tax_info = tax_info;
        this.cash = initial_cash;

        Object.values(filings).forEach(
            (filing) => filing.agi = (filing.gross_income - filing.withholdings || 0)
        )
        this.filings = filings;
        this._events = [];
        this._lifecycles = [];
    }

    get events() {
        return this._events.sort((a, b) => a.date - b.date);
    }

    get lifecycles() {
        return this._lifecycles.sort((a, b) => a.date - b.date);
    }

    get_tax_info(year, region, status, capital_gains = null){
        const key = capital_gains ? 'cap_gains' : 'income';
        const deduction = this.tax_info[year][region].deduction
        const brackets = this.tax_info[year][region].brackets[key]

        return [deduction, brackets]
    }

    grant_option(ticker, price, units, date) {
        var event = new Event('grant option', ticker, price, units, date);
        this._events.push(event);
        var option = new Asset(price, units, date);
        var lifecycle = new Lifecycle(ticker, option);
        this._lifecycles.push(lifecycle);
    }

    grant_options_from_schedule(ticker, price, units, begin_date, cliff_date, cutoff_date=DateTime.utc(), num_months=48) {
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

    split_lifecycle(l, units) {
        // part to leave unsold
        let resized = cloneDeep(l);
        let remainder = cloneDeep(l);
        let base_units = l.option.units
        resized.option.units = units
        remainder.option.units = base_units - units
        if (l.stock) {
            resized.stock.units = units
            remainder.stock.units = base_units - units
        }
        return [resized, remainder]
    }

    evolve_asset(event, ticker, units, date=null, price=null, fmv=null, optimize='date') {
        date = date || DateTime.utc();

        switch (event) {
            case 'sell stocks':
                var [source, destination]  = ['stock', 'sale'];
                break;
            case 'exercise options':
                [source, destination] = ['option', 'stock'];  
                break;
            default:
                throw `${event} is not a valid event`;
        }

        var evolvable = [];
        for (const [i, l] of this._lifecycles.entries()) {
            if (l.ticker == ticker && l[destination] == undefined && l[source] != undefined) {
                evolvable.push([i, l])
            }
        }

        switch (optimize) {
            case 'date':
                evolvable = evolvable.sort((a, b) => a[1][source].date - b[1][source].date);
                break;
            case 'price':
                evolvable = evolvable.sort((a, b) => b[1][source].price - a[1][source].price);
                break;
        }

        for (var [i, l] of evolvable) {
            var s = l[source];
            // if the current cycle can be evolved whole
            if (s.units <= units) {
                this._lifecycles[i][destination] = new Asset(s.price, s.units, date, fmv);
                this._lifecycles[i].date = date;
                units -= s.units;
            // if the current cycle cant be evolved whole, split 
            // into two and evolve just one of them
            } else {
                l.date = date;
                const [resized, remainder] = this.split_lifecycle(l, units);
                this._lifecycles.push(remainder);

                const destination_price = event == 'sell stocks' ? price : s.price;
                resized[destination] = new Asset(destination_price, units, date, fmv);
                this._lifecycles[i] = resized;
                units = 0;
            }
            this._events.push(new Event(event, ticker, s/price, s.units, date, fmv));
            // leave loop if we've exhausted all units
            if (!units){ break; }
        } 

    }
    
    apply_tax_brackets(income, brackets) {
        var taxes = 0;
        each(brackets, (bracket, i) => {
            if (income == 0) {
                return;
            }
            // if we have yet to hit the last bracket
            if (i < brackets.length - 1) {
                var next_bracket_income = brackets[i + 1].income_level
                var income_level_band = next_bracket_income - bracket.income_level
                var portion = min([income, income_level_band])
            // otherwise the rest of the income will be taxed at this last bracket
            } else {
                portion = income
            }
            taxes += portion * bracket['marginal_rate']
            income -= portion
        })
        // if there is income left over after exhausting all brackets
        // tax remainder at highest bracket
        if (income){
            taxes += income * brackets[-1].marginal_rate
        }
        return max([0, taxes])
    }

    calculate_income_taxes(year, gains = null){
        var f = this.filings[year];

        var [standard_state_deduction, state_brackets] = this.get_tax_info(year, f.filing_state, f.filing_status);
        var [standard_federal_deduction, federal_brackets] = this.get_tax_info(year, 'federal', f.filing_status);

        // apply custom deductions if available
        var federal_deduction = get(f, "federal_deduction", standard_federal_deduction);
        var state_deduction = get(f, "state_deduction", standard_state_deduction);

        var agi_deducted_fed = f.agi - federal_deduction;
        var agi_deducted_state = f.agi - state_deduction;
        
        var federal = this.apply_tax_brackets(agi_deducted_fed, federal_brackets);
        var state = this.apply_tax_brackets(agi_deducted_state, state_brackets);

        if (gains != null){
            var federal_with_gains = this.apply_tax_brackets(agi_deducted_fed + gains, federal_brackets);
            var state_with_gains = this.apply_tax_brackets(agi_deducted_state + gains, state_brackets);
            federal = federal_with_gains - federal;
            state = state_with_gains - state;
        }
        return {
            'federal': federal,
            'state': state
        }
    }

    calculate_capital_gains_taxes(year) {
        var f = this.filings[year];

        var lifecycles = groupBy(this._lifecycles, (l) => { 
            return get(l, 'sale') ? l.sale.date.year : undefined; 
        })[year];

        var [short_gains, long_gains] = [0, 0];
        each(lifecycles, (l) => {
            // ISO requirements to qualify for long term cap gains
            const granted_two_years_ago = (l.sale.date - l.option.date).days >= 730;
            const exercised_one_year_ago = (l.sale.date - l.stock.date).days >= 365;
            const stock_basis = l.stock.price * l.stock.units;
            const stock_sale = l.sale.price * l.sale.units;
            if (granted_two_years_ago && exercised_one_year_ago){
                long_gains += stock_sale - stock_basis;
            } else {
                short_gains += stock_sale - stock_basis;
            }
        })
           
        var taxes = this.calculate_income_taxes(year, short_gains);
        var cap_gains_info = this.get_tax_info(year, 'federal', f.filing_status, true);
        taxes.capital_gains = this.apply_tax_brackets(long_gains, cap_gains_info[1]);
        
        return taxes
    }
        
    calculate_amt_taxes(year) {
        const amt_exemption = 72_900;
        const amt_tax_rate = 0.26;
        
        var lifecycles = groupBy(this._lifecycles, (l) => { 
            return get(l, 'stock') ? l.stock.date.year : undefined; 
        })[year];

        var exercised = each(lifecycles, (l) => { if (l.stock != null) {return l}});
        var exercise_spread = sum(each(exercised, (l) => { 
            return (l.stock.fmv * l.stock.units) - (l.option.units * l.option.price) 
        }))

        const amt_base = this.filings[year].agi + exercise_spread - amt_exemption;
        const tmt = amt_base * amt_tax_rate
        const income_taxes = this.calculate_income_taxes(year)
        const amt_tax = max([0, tmt - income_taxes.federal])

        return max([0, amt_tax])
    }
       

};


async function fetch_tax_info(year, region, status) {
    const normalized_region = region.toLowerCase().replace(' ', '_');
    const url = (
        "https://raw.githubusercontent.com/taxee/taxee-tax-statistics" +
        `/master/src/statistics/${min([year, 2020])}/${normalized_region}.json`
    )
    return superagent.get(url).then((res) => {
        const raw_info = JSON.parse(res.text)
        const data = (region == 'federal') ? raw_info.tax_withholding_percentage_method_tables.annual[status] : raw_info[status];
        const deduction = data.deductions[0].deduction_amount;
        const income_brackets = map(data.income_tax_brackets, (d) => {
            return {'income_level': d.bracket, 'marginal_rate': d.marginal_rate / 100}
        })
        var cap_gains_brackets;
        if (region == 'federal') {
            cap_gains_brackets = map(data.income_tax_brackets, (d) => {
                return {'income_level': d.bracket, 'marginal_rate': d.marginal_capital_gain_rate / 100}
            })
        }
        const info =  {
            [region]: {
                'deduction': deduction,
                'brackets': {
                    'income': income_brackets,
                    'cap_gains': cap_gains_brackets
                }
            }
        }
        return [year, info]
    }).catch((err) => {
        throw err
        // throw new Error(`"${region}" is not a valid region or ${year} is not a valid year`);
    })
}

async function cached_tax_info(filings, tax_info) {
    const tups = flatMap(toPairs(filings), ([year, filing]) => {
        const state = {
            year: year, 
            region: filing.filing_state,
            status: filing.filing_status
        };
        // make sure to also grab the federal version of any year listed
        const federal = {
            year: year, 
            region: 'federal', 
            status: filing.filing_status
        };
        return [state, federal]
    })
    const promises = []
    
    each(tups, (t) => {
        let key = `${t.year}.${t.region}`;
        if (get(tax_info, key) == undefined){
            promises.push(fetch_tax_info(t.year, t.region, t.status));
        }
    });
    const tax_info_raw = await Promise.all(promises);
    each(tax_info_raw, (v) => {
        tax_info[v[0]] = merge(get(tax_info, v[0], {}), v[1])
    })
    return tax_info;
}

async function run(filings, tax_info) {
    tax_info = await cached_tax_info(filings, tax_info);  
    tax_info = await cached_tax_info(filings, tax_info); 
    var p = new Portfolio(tax_info, filings, 13_000);
    p.grant_options_from_schedule('JEFF', 2.18, 8000, DateTime.utc(2019, 1, 30), DateTime.utc(2020, 1, 30));
    p.grant_options_from_schedule('JEFF', 3.08, 5000, DateTime.utc(2020, 6, 1), null);
    p.evolve_asset('exercise options', 'JEFF', 2400, DateTime.utc(2020, 12, 30), null, 15);
    p.evolve_asset('exercise options', 'JEFF', 1600, DateTime.utc(2021, 1, 31), null, 16.57);
    p.evolve_asset('sell stocks', 'JEFF', 1000, DateTime.utc(), 50);
    return p
}

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

var tax_info = {};


run(filings, tax_info).then((p) => {
    console.log(p.events);
    console.log(p.lifecycles);
    console.log([p.calculate_amt_taxes(2021), p.calculate_capital_gains_taxes(2021)]);
}); 


