import { Controller, GET, POST, PUT, DELETE } from 'plat'
import type { RouteContext } from 'plat'
import type { Post, CreatePostInput, UpdatePostInput, ListPostsInput, ListPostsOutput } from '../types/blog'

const posts: Map<number, Post> = new Map([
  [1, {
    id: 1,
    title: 'Welcome to plat',
    content: 'plat is a modern API framework with flat routing and strong opinions.',
    author: 'Team plat',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }],
])

let nextId = 2

@Controller()
export class BlogApi {
  @GET()
  async listPosts(input: ListPostsInput = {}, ctx: RouteContext): Promise<ListPostsOutput> {
    const { limit = 10, offset = 0 } = input
    const all = Array.from(posts.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return {
      posts: all.slice(offset, offset + limit),
      total: all.length,
    }
  }

  @GET()
  async getPost(input: { id: number }, ctx: RouteContext): Promise<Post> {
    const post = posts.get(input.id)
    if (!post) throw new Error(`Post ${input.id} not found`)
    return post
  }

  @POST()
  async createPost(input: CreatePostInput, ctx: RouteContext): Promise<Post> {
    const id = nextId++
    const now = new Date().toISOString()
    const post: Post = { id, ...input, createdAt: now, updatedAt: now }
    posts.set(id, post)
    return post
  }

  @PUT()
  async updatePost(input: UpdatePostInput, ctx: RouteContext): Promise<Post> {
    const post = posts.get(input.id)
    if (!post) throw new Error(`Post ${input.id} not found`)

    const updated: Post = {
      ...post,
      ...(input.title !== undefined && { title: input.title }),
      ...(input.content !== undefined && { content: input.content }),
      ...(input.author !== undefined && { author: input.author }),
      updatedAt: new Date().toISOString(),
    }

    posts.set(input.id, updated)
    return updated
  }

  @DELETE()
  async deletePost(input: { id: number }, ctx: RouteContext) {
    const post = posts.get(input.id)
    if (!post) throw new Error(`Post ${input.id} not found`)
    posts.delete(input.id)
    return { success: true, id: input.id }
  }
}
