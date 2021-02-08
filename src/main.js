import { cloneDeep, min, max, map, each, get, sum, groupBy, merge,  toPairs, flatMap} from 'lodash';
var superagent = require('superagent');
import { DateTime, Duration } from 'luxon';
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

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
    constructor(taxInfo, filings, initialCash) {
        this.taxInfo = taxInfo;
        this.cash = initialCash;

        Object.values(filings).forEach(
            (filing) => filing.agi = (filing.grossIncome - filing.withholdings || 0)
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

    getTaxInfo(year, region, status, capitalGains = null){
        const key = capitalGains ? 'capGains' : 'income';
        const deduction = this.taxInfo[year][region].deduction
        const brackets = this.taxInfo[year][region].brackets[key]

        return [deduction, brackets]
    }

    grantOption(ticker, price, units, date) {
        var event = new Event('grant option', ticker, price, units, date);
        this._events.push(event);
        var option = new Asset(price, units, date);
        var lifecycle = new Lifecycle(ticker, option);
        this._lifecycles.push(lifecycle);
    }

    grantOptionsFromSchedule(ticker, price, units, beginDate, cliffDate, cutoffDate=DateTime.utc(), numMonths=48) {
        if (cliffDate) {
            if (cutoffDate < cliffDate) { return null; }
            else if (cliffDate != beginDate) {
                let froYear = (cliffDate.year - beginDate.year) * 12;
                let fromMonths = (cliffDate.month - beginDate.month);
                let monthsVestedAtCliff = froYear + fromMonths;
                let cliffUnits = Math.floor((units / numMonths) * monthsVestedAtCliff);
                this.grantOption(ticker, price, cliffUnits, cliffDate);
                
                units -= cliffUnits;
                numMonths -= monthsVestedAtCliff;
                beginDate = cliffDate;
            }
        }
        var rawChunkSize = ~~(units/numMonths);
        var remainder = units % numMonths;
        var i;
        for (i = 0; i < numMonths; i++) {
            // "consume" from the remainder while it exists
            let chunkSize = i > remainder ? rawChunkSize + 1 : rawChunkSize;
            let chunkDate = beginDate.plus(Duration.fromObject({months: i}));
            
            // we can't get grants until the cliff (if it exists) is over
            let beyondCliff = (cliffDate === undefined || chunkDate >= cliffDate);
            // we want to add chunks up until this point in time unless
            // the cutoff date is manually set into the future
            let notCutOff = (cutoffDate === undefined || chunkDate <= cutoffDate);
            if (beyondCliff && notCutOff) {
                this.grantOption(ticker, price, chunkSize, chunkDate) ;   
            }
        }
        
    }

    splitLifecycle(l, units) {
        // part to leave unsold
        let resized = cloneDeep(l);
        let remainder = cloneDeep(l);
        let baseUnits = l.option.units
        resized.option.units = units
        remainder.option.units = baseUnits - units
        if (l.stock) {
            resized.stock.units = units
            remainder.stock.units = baseUnits - units
        }
        return [resized, remainder]
    }

    evolveAsset(event, ticker, units, date=null, price=null, fmv=null, optimize='date') {
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
                const [resized, remainder] = this.splitLifecycle(l, units);
                this._lifecycles.push(remainder);

                const destinationPrice = event == 'sell stocks' ? price : s.price;
                resized[destination] = new Asset(destinationPrice, units, date, fmv);
                this._lifecycles[i] = resized;
                units = 0;
            }
            this._events.push(new Event(event, ticker, s/price, s.units, date, fmv));
            // leave loop if we've exhausted all units
            if (!units){ break; }
        } 

    }
    
    applyTaxBrackets(income, brackets) {
        var taxes = 0;
        each(brackets, (bracket, i) => {
            if (income == 0) {
                return;
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
        if (income){
            taxes += income * brackets[-1].marginalRate
        }
        return max([0, taxes])
    }

    calculateIncomeTaxes(year, gains = null){
        var f = this.filings[year];

        var [standardStateDeduction, stateBrackets] = this.getTaxInfo(year, f.filingState, f.filingStatus);
        var [standardFederalDeduction, federalBrackets] = this.getTaxInfo(year, 'federal', f.filingStatus);

        // apply custom deductions if available
        var federalDeduction = get(f, "federalDeduction", standardFederalDeduction);
        var stateDeduction = get(f, "stateDeduction", standardStateDeduction);

        var agiDeductedFed = f.agi - federalDeduction;
        var agiDeductedState = f.agi - stateDeduction;
        
        var federal = this.applyTaxBrackets(agiDeductedFed, federalBrackets);
        var state = this.applyTaxBrackets(agiDeductedState, stateBrackets);

        if (gains != null){
            var federalWithGains = this.applyTaxBrackets(agiDeductedFed + gains, federalBrackets);
            var stateWithGains = this.applyTaxBrackets(agiDeductedState + gains, stateBrackets);
            federal = federalWithGains - federal;
            state = stateWithGains - state;
        }
        return {
            'federal': federal,
            'state': state
        }
    }

    calculateCapitalGainsTaxes(year) {
        var f = this.filings[year];

        var lifecycles = groupBy(this._lifecycles, (l) => { 
            return get(l, 'sale') ? l.sale.date.year : undefined; 
        })[year];

        var [shorGains, longGains] = [0, 0];
        each(lifecycles, (l) => {
            // ISO requirements to qualify for long term cap gains
            const grantedTwoYearsAgo = (l.sale.date - l.option.date).days >= 730;
            const exercisedOnYearAgo = (l.sale.date - l.stock.date).days >= 365;
            const stockBasis = l.stock.price * l.stock.units;
            const stockSale = l.sale.price * l.sale.units;
            if (grantedTwoYearsAgo && exercisedOnYearAgo){
                longGains += stockSale - stockBasis;
            } else {
                shorGains += stockSale - stockBasis;
            }
        })
           
        var taxes = this.calculateIncomeTaxes(year, shorGains);
        var capGainsInfo = this.getTaxInfo(year, 'federal', f.filingStatus, true);
        taxes.capitalGains = this.applyTaxBrackets(longGains, capGainsInfo[1]);
        
        return taxes
    }
        
    calculateAmtTaxes(year) {
        const amtExemption = 72_900;
        const amtTaxRate = 0.26;
        
        var lifecycles = groupBy(this._lifecycles, (l) => { 
            return get(l, 'stock') ? l.stock.date.year : undefined; 
        })[year];

        var exercised = each(lifecycles, (l) => { if (l.stock != null) {return l}});
        var exerciseSpread = sum(each(exercised, (l) => { 
            return (l.stock.fmv * l.stock.units) - (l.option.units * l.option.price) 
        }))

        const amBase = this.filings[year].agi + exerciseSpread - amtExemption;
        const tmt = amBase * amtTaxRate
        const incomeTaxes = this.calculateIncomeTaxes(year)
        const amtTax = max([0, tmt - incomeTaxes.federal])

        return max([0, amtTax])
    }
       

};


async function fetchTaxInfo(year, region, status) {
    const normalizedRegion = region.toLowerCase().replace(' ', '_');
    const url = (
        "https://raw.githubusercontent.com/taxee/taxee-tax-statistics" +
        `/master/src/statistics/${min([year, 2020])}/${normalizedRegion}.json`
    )
    return superagent.get(url).then((res) => {
        const rawInfo = JSON.parse(res.text)
        const data = (region == 'federal') ? rawInfo.taxWithholdingPercentageMethodTables.annual[status] : rawInfo[status];
        const deduction = data.deductions[0].deductioAmount;
        const incomeBrackets = map(data.incomeTaxBrackets, (d) => {
            return {'incomeLevel': d.bracket, 'marginalRate': d.marginalRate / 100}
        })
        var capGainsBrackets;
        if (region == 'federal') {
            capGainsBrackets = map(data.incomeTaxBrackets, (d) => {
                return {'incomeLevel': d.bracket, 'marginalRate': d.marginalCapitalGainRate / 100}
            })
        }
        const info =  {
            [region]: {
                'deduction': deduction,
                'brackets': {
                    'income': incomeBrackets,
                    'capGains': capGainsBrackets
                }
            }
        }
        return [year, info]
    }).catch((err) => {
        throw err
        // throw new Error(`"${region}" is not a valid region or ${year} is not a valid year`);
    })
}

async function cachedTaxInfo(filings, taxInfo) {
    const tups = flatMap(toPairs(filings), ([year, filing]) => {
        const state = {
            year: year, 
            region: filing.filingState,
            status: filing.filingStatus
        };
        // make sure to also grab the federal version of any year listed
        const federal = {
            year: year, 
            region: 'federal', 
            status: filing.filingStatus
        };
        return [state, federal]
    })
    const promises = []
    
    each(tups, (t) => {
        let key = `${t.year}.${t.region}`;
        if (get(taxInfo, key) == undefined){
            promises.push(fetchTaxInfo(t.year, t.region, t.status));
        }
    });
    const taxInfoRaw = await Promise.all(promises);
    each(taxInfoRaw, (v) => {
        taxInfo[v[0]] = merge(get(taxInfo, v[0], {}), v[1])
    })
    return taxInfo;
}

export async function run(filings, taxInfo) {
    taxInfo = await cachedTaxInfo(filings, taxInfo);  
    taxInfo = await cachedTaxInfo(filings, taxInfo); 
    var p = new Portfolio(taxInfo, filings, 13_000);
    p.grantOptionsFromSchedule('JEFF', 2.18, 8000, DateTime.utc(2019, 1, 30), DateTime.utc(2020, 1, 30));
    p.grantOptionsFromSchedule('JEFF', 3.08, 5000, DateTime.utc(2020, 6, 1), null);
    p.evolveAsset('exercise options', 'JEFF', 2400, DateTime.utc(2020, 12, 30), null, 15);
    p.evolveAsset('exercise options', 'JEFF', 1600, DateTime.utc(2021, 1, 31), null, 16.57);
    p.evolveAsset('sell stocks', 'JEFF', 1000, DateTime.utc(), 50);
    return p
}

export async function runThenLog(filings, taxInfo) {
    run(filings, taxInfo).then((p) => {
        console.log(p.events);
        console.log(p.lifecycles);
        console.log([p.calculateAmtTaxes(2021), p.calculateCapitalGainsTaxes(2021)]);
    }); 
}


createApp(App).use(router).mount('#app')
