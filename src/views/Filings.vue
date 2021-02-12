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
    <div v-for="(filing, year) in p.filings" :key="year">
        <Filing v-model="p.filings[year]" :year=+year />
    </div>
    <button id="filings-button-add-future-year" @click="addYear(futureYear)">Add filing for {{ futureYear }}</button>
  </div>
</template>

<script>
import Filing from '@/components/Filing.vue';

export default {
  name: 'Filings',
  components: {
    Filing
  }, 
  inject: ['p'],
  computed: {
    years() {
      let keys = Object.keys(this.p.filings);
      keys.sort();
      return keys;
    },
    pastYear() { return +this.years[0] - 1 },
    futureYear() { return +this.years[this.years.length - 1] + 1}
  },
  methods: {
    addYear(year) {
      this.p.updateFiling(+year)
    }
  }
}
</script>