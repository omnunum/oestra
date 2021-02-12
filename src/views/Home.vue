<template>
  <div class="home">
    <img alt="Vue logo" src="../assets/logo.png">
    <Filings v-model="p.filings"/>
  </div>
</template>

<script>
// @ is an alias to /src
import Filings from '@/views/Filings.vue'

export default {
  name: 'Home',
  inject: ['p'],
  components: {
    Filings
  }
}
</script>
