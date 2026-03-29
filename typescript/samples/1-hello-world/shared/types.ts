export interface SayHelloInput {
  name?: string
}

export interface EchoInput {
  text: string // min: 1
}

export interface Message {
  text: string
  timestamp: string // format: date-time
}
