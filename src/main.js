import { DateTime } from 'luxon';
import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { Portfolio } from './js/portfolio';

export function run(filings) {
    var p = new Portfolio(filings, 13_000);
    p.grantOptionsFromSchedule('JEFF', 2.18, 8000, DateTime.utc(2019, 1, 30), DateTime.utc(2020, 1, 30));
    p.grantOptionsFromSchedule('JEFF', 3.08, 5000, DateTime.utc(2020, 6, 1), null);
    p.evolveAsset('exercise options', 'JEFF', 2400, DateTime.utc(2020, 12, 30), null, 15);
    p.evolveAsset('exercise options', 'JEFF', 1600, DateTime.utc(2021, 1, 31), null, 16.57);
    p.evolveAsset('sell stocks', 'JEFF', 1000, DateTime.utc(), 50);
    return p
}

export function runThenLog(filings) {
    run(filings).then((p) => {
        console.log(p.events);
        console.log(p.lifecycles);
        console.log([p.calculateAmtTaxes(2021), p.calculateCapitalGainsTaxes(2021)]);
    }); 
}


createApp(App).use(router).mount('#app')
