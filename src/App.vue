<template>
  <div id="nav">
    <router-link to="/">Home</router-link> |
    <router-link to="/filings">Filings</router-link>
  </div>
  <router-view/>
</template>

<script>
import { Portfolio } from './js/portfolio'
var p = new Portfolio();
const filings = {
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
   provide: {
     p
   }, 
   beforeMount() { 
     for (const year in filings) {
       p.updateFiling(year, filings[year])
     }
   }
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
}

#nav {
  padding: 30px;
}

#nav a {
  font-weight: bold;
  color: #2c3e50;
}

#nav a.router-link-exact-active {
  color: #42b983;
}
</style>
