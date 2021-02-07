<template id="main">
  <img alt="Vue logo" src="./assets/logo.png">
  <Filing msg="from hello" />:
  <HelloWorld msg="frick" />
</template>

<script>
import HelloWorld from './components/HelloWorld.vue'
import Filing from './components/Filing.vue'


export default {
  name: 'App',
  components: {
    HelloWorld,
    Filing
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
  margin-top: 60px;
}
</style>
