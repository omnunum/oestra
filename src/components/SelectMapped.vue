<template id="select-mapped">
  <select v-model="value">
    <option v-for="item in items" :key=item.key :value=item.key>
      {{ item.display }}
    </option>
  </select>
</template>

<script>
import {map, compact} from 'lodash';


export default {
  name: 'SelectMapped',
  props: {
    modelValue: String,
    keys: Array,
    mapper: Function
  },
  emits: ['update:modelValue'],
  computed:  {
    items() { 
      var formatted = map(this.keys, (k) => {
        return {
          key: k, 
          display:  this.mapper ? this.mapper(k): k
        }
      })
      return compact(formatted)
    },
    value: {
      get() { return this.modelValue },
      set(s) { this.$emit('update:modelValue', s) }
    }
  }
}
</script>