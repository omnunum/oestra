import { createRouter, createWebHashHistory } from 'vue-router'
import Home from '../views/Home.vue'
import Filings from '../views/Filings.vue'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home
  },
  {
    path: '/filings',
    name: 'Filings',
    component: Filings
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
