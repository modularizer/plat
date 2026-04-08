/**
 * Auto-generated OpenAPI client bootstrap.
 * Source: /home/mod/Code/plat/typescript/samples/5-client-only/openapi.json
 * DO NOT EDIT MANUALLY.
 */

import { OpenAPIClient, type OpenAPIClientConfig } from 'plat'
import type { OpenAPISpec } from 'plat'

export const openAPISpec = {
  "openapi": "3.1.0",
  "info": {
    "title": "E-commerce API",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "http://localhost:3000"
    }
  ],
  "paths": {
    "/products/listProducts": {
      "get": {
        "tags": [
          "products"
        ],
        "operationId": "listProducts",
        "parameters": [
          {
            "name": "category",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "inStock",
            "in": "query",
            "schema": {
              "type": "boolean"
            }
          },
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
                  "type": "object",
                  "properties": {
                    "products": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/Product"
                      }
                    },
                    "total": {
                      "type": "integer"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/products/getProduct": {
      "get": {
        "tags": [
          "products"
        ],
        "operationId": "getProduct",
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
                  "$ref": "#/components/schemas/Product"
                }
              }
            }
          }
        }
      }
    },
    "/products/searchProducts": {
      "get": {
        "tags": [
          "products"
        ],
        "operationId": "searchProducts",
        "parameters": [
          {
            "name": "q",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "limit",
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
                  "type": "object",
                  "properties": {
                    "products": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/Product"
                      }
                    },
                    "total": {
                      "type": "integer"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/orders/getCart": {
      "get": {
        "tags": [
          "orders"
        ],
        "operationId": "getCart",
        "parameters": [
          {
            "name": "userId",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Cart"
                }
              }
            }
          }
        }
      }
    },
    "/orders/addToCart": {
      "post": {
        "tags": [
          "orders"
        ],
        "operationId": "addToCart",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "userId": {
                    "type": "string"
                  },
                  "productId": {
                    "type": "integer"
                  },
                  "quantity": {
                    "type": "integer"
                  }
                },
                "required": [
                  "userId",
                  "productId",
                  "quantity"
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
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/orders/checkout": {
      "post": {
        "tags": [
          "orders"
        ],
        "operationId": "checkout",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "userId": {
                    "type": "string"
                  }
                },
                "required": [
                  "userId"
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
                  "$ref": "#/components/schemas/Order"
                }
              }
            }
          }
        }
      }
    },
    "/orders/listOrders": {
      "get": {
        "tags": [
          "orders"
        ],
        "operationId": "listOrders",
        "parameters": [
          {
            "name": "userId",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
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
                  "type": "object",
                  "properties": {
                    "orders": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/Order"
                      }
                    },
                    "total": {
                      "type": "integer"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/orders/getOrder": {
      "get": {
        "tags": [
          "orders"
        ],
        "operationId": "getOrder",
        "parameters": [
          {
            "name": "id",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Order"
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
      "Product": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer"
          },
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "price": {
            "type": "number"
          },
          "category": {
            "type": "string"
          },
          "inStock": {
            "type": "boolean"
          },
          "quantity": {
            "type": "integer"
          }
        },
        "required": [
          "id",
          "name",
          "description",
          "price",
          "category",
          "inStock",
          "quantity"
        ]
      },
      "CartItem": {
        "type": "object",
        "properties": {
          "productId": {
            "type": "integer"
          },
          "quantity": {
            "type": "integer"
          },
          "priceAtAdded": {
            "type": "number"
          }
        },
        "required": [
          "productId",
          "quantity",
          "priceAtAdded"
        ]
      },
      "Cart": {
        "type": "object",
        "properties": {
          "userId": {
            "type": "string"
          },
          "items": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/CartItem"
            }
          },
          "subtotal": {
            "type": "number"
          }
        },
        "required": [
          "userId",
          "items",
          "subtotal"
        ]
      },
      "Order": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "userId": {
            "type": "string"
          },
          "items": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/CartItem"
            }
          },
          "total": {
            "type": "number"
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "processing",
              "shipped",
              "delivered"
            ]
          },
          "createdAt": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "userId",
          "items",
          "total",
          "status",
          "createdAt"
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
