<template id="filing">
  <div>
    <h1>{{ msg }}</h1>
    <textarea id="filing-input" v-model="filings_text" />
    <button id="filing-button-run" @click="run_then_log(filings, tax_info)" class="btn btn-primary"> Run me brah </button>
  </div>
</template>

<script>

import {run_then_log} from '../main'

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


export default {
  name: 'Filing',
  props: {
    msg: String
  },
  methods: {
      run_then_log
  },
  data() {
    return {
      filings, 
      tax_info
    }
  },
  computed: {
      filings_text() { return JSON.stringify(this.filings) }
  }
}

</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
h3 {
  margin: 40px 0 0;
}
ul {
  list-style-type: none;
  padding: 0;
}
li {
  display: inline-block;
  margin: 0 10px;
}
a {
  color: #42b983;
}
</style>
