import { createServer } from 'plat'
import { ProductsApi } from './server/products.api'
import { OrdersApi } from './server/orders.api'

const server = createServer({ port: 3000, cors: true }, ProductsApi, OrdersApi)

server.listen()
console.log('E-commerce API running on http://localhost:3000')
console.log('Try:')
console.log('  curl http://localhost:3000/products/listProducts')
console.log('  curl http://localhost:3000/products/getProduct?id=1')
console.log('  curl http://localhost:3000/products/searchProducts?q=laptop')
console.log('  curl http://localhost:3000/orders/getCart?userId=user1')
