<template>
  <div id="filings">
    <button id="filings-button-add-future-year" @click="addYear(pastYear)">Add filing for {{ pastYear}}</button>
    <div class="row">
        <div class="col"><span>Year</span></div>
        <div class="col"><span>Gross Income</span></div>
        <div class="col"><span>Withholdings</span></div>
        <div class="col"><span>State</span></div>
        <div class="col"><span>Status</span></div>
    </div>
    <Filing 
      v-for="(filing, year) in filings" 
      :key=year
      :year=+year
      :filing=filing
    />
    <button id="filings-button-add-future-year" @click="addYear(futureYear)">Add filing for {{ futureYear }}</button>
  </div>
</template>

<script>
import Filing from '@/components/Filing.vue';

var filings = {
    2019: {
        "grossIncome": 126_730.64,
        "withholdings": (6_000 + 2_395.91 + 23),
        "filingState": "georgia",
        "filingStatus": "single"
    }, 
    2020: {
        "grossIncome": 127_200,
        "withholdings": (18_000 + 2_500 + 22),
        "filingState": "georgia",
        "filingStatus": "single"
    },
    2021: {
        "grossIncome": 130_800,
        "withholdings": (18_000 + 2_500 + 22),
        "filingState": "georgia",
        "filingStatus": "single"
    }
}

export default {
  name: 'Filings',
  components: {
    Filing
  }, 
  data() { 
    return {
       filings
    }
  },
  computed: {
    years() {
        let keys = Object.keys(this.filings);
        keys.sort();
        return keys;
    },
    pastYear() { return +this.years[0] - 1 },
    futureYear() { return +this.years[this.years.length - 1] + 1},
  },
  methods: {
      addYear(year) {
          this.filings[+year] = {}
      }
  }
}
</script>