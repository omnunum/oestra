<template>
  <div class="home">
    <img alt="Vue logo" src="../assets/logo.png">
    <Filings v-model="filings"/>
  </div>
</template>

<script>
// @ is an alias to /src
import Filings from '@/views/Filings.vue'

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
  name: 'Home',
  components: {
    Filings
  },
  data() { return {
    filings
  }}
}
</script>
