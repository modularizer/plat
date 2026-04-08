/**
 * Auto-generated OpenAPI client bootstrap.
 * Source: /home/mod/Code/plat/typescript/samples/2-blog-crud/openapi.json
 * DO NOT EDIT MANUALLY.
 */

import { OpenAPIClient, type OpenAPIClientConfig } from 'plat'
import type { OpenAPISpec } from 'plat'

export const openAPISpec = {
  "openapi": "3.1.0",
  "info": {
    "title": "Blog CRUD API",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "http://localhost:3000"
    }
  ],
  "paths": {
    "/listPosts": {
      "get": {
        "operationId": "listPosts",
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer"
            }
          },
          {
            "name": "offset",
            "in": "query",
            "schema": {
              "type": "integer"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/PostList"
                }
              }
            }
          }
        }
      }
    },
    "/getPost": {
      "get": {
        "operationId": "getPost",
        "parameters": [
          {
            "name": "id",
            "in": "query",
            "required": true,
            "schema": {
              "type": "integer"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Post"
                }
              }
            }
          }
        }
      }
    },
    "/createPost": {
      "post": {
        "operationId": "createPost",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreatePostInput"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Post"
                }
              }
            }
          }
        }
      }
    },
    "/updatePost": {
      "put": {
        "operationId": "updatePost",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "allOf": [
                  {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "integer"
                      }
                    },
                    "required": [
                      "id"
                    ]
                  },
                  {
                    "$ref": "#/components/schemas/UpdatePostInput"
                  }
                ]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Post"
                }
              }
            }
          }
        }
      }
    },
    "/deletePost": {
      "delete": {
        "operationId": "deletePost",
        "parameters": [
          {
            "name": "id",
            "in": "query",
            "required": true,
            "schema": {
              "type": "integer"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "id": {
                      "type": "integer"
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "Post": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer"
          },
          "title": {
            "type": "string"
          },
          "content": {
            "type": "string"
          },
          "author": {
            "type": "string"
          },
          "createdAt": {
            "type": "string"
          },
          "updatedAt": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "title",
          "content",
          "author",
          "createdAt",
          "updatedAt"
        ]
      },
      "CreatePostInput": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string"
          },
          "content": {
            "type": "string"
          },
          "author": {
            "type": "string"
          }
        },
        "required": [
          "title",
          "content",
          "author"
        ]
      },
      "UpdatePostInput": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string"
          },
          "content": {
            "type": "string"
          },
          "author": {
            "type": "string"
          }
        }
      },
      "PostList": {
        "type": "object",
        "properties": {
          "posts": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/Post"
            }
          },
          "total": {
            "type": "integer"
          }
        },
        "required": [
          "posts",
          "total"
        ]
      }
    }
  }
} as const satisfies OpenAPISpec

export type ApiSpec = typeof openAPISpec
export type ApiClient = OpenAPIClient<ApiSpec>

export const defaultBaseUrl = "http://localhost:3000"

export function createClient(
  baseUrl: string = defaultBaseUrl,
  config?: OpenAPIClientConfig,
): ApiClient {
  return new OpenAPIClient<ApiSpec>(openAPISpec, { ...config, baseUrl })
}

export default createClient
