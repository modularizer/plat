export interface Post {
  id: number        // min: 1
  title: string     // min: 1, max: 200
  content: string   // min: 1
  author: string    // min: 1, max: 100
  createdAt: string // format: date-time
  updatedAt: string // format: date-time
}

export interface CreatePostInput {
  title: string     // min: 1, max: 200
  content: string   // min: 1
  author: string    // min: 1, max: 100
}

export interface UpdatePostInput {
  id: number        // min: 1
  title?: string    // min: 1, max: 200
  content?: string
  author?: string   // min: 1, max: 100
}

export interface ListPostsInput {
  limit?: number    // integer, min: 1, max: 100, default: 10
  offset?: number   // integer, min: 0, default: 0
}

export interface ListPostsOutput {
  posts: Post[]
  total: number     // integer
}
