import { createServer } from 'plat'
import { BlogApi } from './api/blog.api'

const server = createServer({ port: 3000, cors: true }, BlogApi)

server.listen()
console.log('Blog API running on http://localhost:3000')
console.log('Try:')
console.log('  curl http://localhost:3000/listPosts')
console.log('  curl http://localhost:3000/getPost?id=1')
console.log('  curl -X POST http://localhost:3000/createPost -d \'{"title":"Hello","content":"World","author":"Me"}\' -H "Content-Type: application/json"')
