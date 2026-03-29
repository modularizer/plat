import { createServer } from 'plat'
import { HelloApi } from './server/hello.api'

const server = createServer({ port: 3000, cors: true }, HelloApi)

server.listen()
console.log('Hello World API running on http://localhost:3000')
console.log('Try: curl http://localhost:3000/sayHello?name=plat')
