<template id="states">
  <select v-model="state">
    <option v-for="state in states" :key=state.key :value=state.key>{{ state.display }}</option>
  </select>
</template>

<script>
import {startCase, map} from 'lodash';
import Taxee from 'taxee-tax-statistics';


export default {
  name: 'SelectStates',
  props: {
    modelValue: String
  },
  emits: ['update:modelValue'],
  computed:  {
    states() { 
      let keys = Object.keys(Taxee[2020])
      var formatted = map(keys, (k) => {
        return {
          key: k, 
          display: startCase(k.replace('_', ' '))
        }
      })
      return formatted
    },
    state: {
      get() { return this.modelValue },
      set(s) { this.$emit('update:modelValue', s) }
    }
  }
}
</script>