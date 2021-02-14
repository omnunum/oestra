<template id="filing">
  <div class="row">
    <div class="col"><span>{{year}}</span> </div>
    <div class="col"><input v-model.number="filing.grossIncome" /> </div>
    <div class="col"><input v-model.number="filing.withholdings" /> </div>
    <div class="col">
      <select-mapped 
        v-model="filing.filingState"
        :keys="states"
        :mapper="selectMapper" />
    </div>
    <div class="col">
      <select-mapped 
        v-model="filing.filingStatus"
        :keys="statuses"
        :mapper="selectMapper" />
    </div>
  </div>
</template>

<script>
import SelectMapped from '@/components/SelectMapped.vue';
import Taxee from 'taxee-tax-statistics';
import { startCase } from 'lodash';

export default {
  name: 'Filing',  
  props: {
    year: Number,
    modelValue: Object
  },
  data() { return { 
    filing: this.modelValue,
  }},
  inject: ['p'],
  components: {
    SelectMapped
  },
  computed: {
    states() { return Object.keys(Taxee[2020]).filter((f) => f != 'federal') },
    statuses() { return Object.keys(Taxee[2020]['california']) }
  },
  methods: {
    selectMapper(key) { return startCase(key.replace('_', ' ')).replace('Of', 'of') }
  },
  watch: {
    filing: {
      handler(n) { this.$emit('update:modelValue', n)},
      deep: true
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
