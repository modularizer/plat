import { Controller, GET, POST } from 'plat'
import type { RouteContext } from 'plat'
import type { SayHelloInput, EchoInput, Message } from '../shared/types'

@Controller()
export class HelloApi {
  @GET()
  async sayHello(input: SayHelloInput = {}, ctx: RouteContext) {
    return {
      message: `Hello ${input.name || 'World'}!`,
      timestamp: new Date().toISOString(),
    }
  }

  @POST()
  async echo(input: EchoInput, ctx: RouteContext): Promise<Message> {
    return {
      text: input.text,
      timestamp: new Date().toISOString(),
    }
  }

  @GET()
  async getStatus(_input: {} = {}, ctx: RouteContext) {
    return { status: 'ok', uptime: process.uptime() }
  }
}
