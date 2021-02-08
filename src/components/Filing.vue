<template id="filing">
  <div class="row">
    <div class="col"><span>{{year}}</span> </div>
    <div class="col"><input v-model.number="grossIncome" /> </div>
    <div class="col"><input v-model.number="withholdings" /> </div>
    <div class="col">
      <select-states v-model="filingState" />
    </div>
  </div>
</template>

<script>
import SelectStates from '@/components/SelectStates.vue';

export default {
  name: 'Filing',
  props: {
    year: Number,
    filing: Object
  },
  components: {
    SelectStates
  },
  data() { return {
      grossIncome: this.grossIncome || this.filing.grossIncome, 
      withholdings: this.withholdings || this.filing.withholdings, 
      filingState: this.filingState || this.filing.filingState
    }
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
