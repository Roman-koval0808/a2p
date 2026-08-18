/**
 * GENERATED FILE - do not edit by hand.
 * Regenerate with: node scripts/gen-openapi.mjs
 */

// @ts-nocheck
export default {
  "openapi": "3.0.0",
  "info": {
    "title": "ClearSky / A2P Backend API",
    "version": "1.0.0",
    "description": "REST API for the ClearSky dialer, messaging, contacts, notifications and call tracking backend. Auth via `Authorization: Bearer <token>` (token returned by POST /api/auth/login) or the app_session cookie."
  },
  "servers": [
    {
      "url": "http://localhost:3005",
      "description": "Backend server"
    }
  ],
  "paths": {
    "/api/a2p/cohort2/sweep": {
      "post": {
        "summary": "External-cron alternative to the in-process Section 8 loss sweep (see hooks.server.ts).",
        "tags": [
          "a2p"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/a2p/communication-log": {
      "get": {
        "summary": null,
        "tags": [
          "a2p"
        ],
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "offset",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "contactId",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "channel",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "direction",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "internalTsFrom",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "internalTsTo",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/a2p/contacts": {
      "get": {
        "summary": null,
        "tags": [
          "a2p"
        ],
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/a2p/emails/incoming": {
      "get": {
        "summary": null,
        "tags": [
          "a2p"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/a2p/emails/sweep": {
      "post": {
        "summary": "Sweep endpoint to sync emails from connected Google Accounts.",
        "tags": [
          "a2p"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/a2p/jobs/complete": {
      "post": {
        "summary": "Job-fulfillment trigger endpoint (Epics 6/7). A rep/back-office marks a job complete;",
        "tags": [
          "a2p"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/a2p/orchestrator/run_once": {
      "post": {
        "summary": null,
        "tags": [
          "a2p"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/a2p/sla/check": {
      "post": {
        "summary": "Cron entrypoint for the SLA-breach detector (T3.4). Call on a short interval",
        "tags": [
          "a2p"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/a2p/supplier/delivery": {
      "post": {
        "summary": "Supplier-delivery-received trigger (Epic 6, T6.5). Back-office marks a supplier",
        "tags": [
          "a2p"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/a2p/threads": {
      "get": {
        "summary": null,
        "tags": [
          "a2p"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/a2p/timers/sweep": {
      "post": {
        "summary": null,
        "tags": [
          "a2p"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/account": {
      "delete": {
        "summary": null,
        "tags": [
          "account"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/area-codes": {
      "get": {
        "summary": null,
        "tags": [
          "area-codes"
        ],
        "parameters": [
          {
            "name": "country",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/auth/forgot-password": {
      "post": {
        "summary": "Request a password reset code",
        "tags": [
          "auth"
        ],
        "responses": {
          "200": {
            "description": "Reset code sent",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          }
        }
      }
    },
    "/api/auth/login": {
      "post": {
        "summary": "Log in with email and password",
        "tags": [
          "auth"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email",
                  "password"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "format": "email"
                  },
                  "password": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Authenticated. Returns the JWT used as `Authorization: Bearer <token>`.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/UserTokenResponse"
                }
              }
            }
          },
          "401": {
            "description": "Invalid email or password",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/auth/otp/send": {
      "post": {
        "summary": "Send a 5-digit verification code by email (intent: login | signup)",
        "tags": [
          "auth"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "format": "email"
                  },
                  "intent": {
                    "type": "string",
                    "enum": [
                      "login",
                      "signup"
                    ],
                    "default": "login"
                  },
                  "name": {
                    "type": "string",
                    "description": "required when intent=signup"
                  },
                  "password": {
                    "type": "string",
                    "description": "required when intent=signup"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Code sent",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "404": {
            "description": "No account found with this email",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/auth/otp/verify": {
      "post": {
        "summary": "Verify the 5-digit code and exchange it for a session token",
        "tags": [
          "auth"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email",
                  "code"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "format": "email"
                  },
                  "code": {
                    "type": "string",
                    "description": "5-digit code"
                  },
                  "intent": {
                    "type": "string",
                    "enum": [
                      "login",
                      "signup"
                    ],
                    "default": "login"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Verified. Sets app_session cookie; token also returned.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/UserTokenResponse"
                }
              }
            }
          },
          "400": {
            "description": "Invalid or expired code",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/auth/refresh": {
      "post": {
        "summary": "Refresh the session token (requires valid existing token)",
        "tags": [
          "auth"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "New token + user",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/UserTokenResponse"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized or token expired",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/auth/reset-password": {
      "post": {
        "summary": "Reset the password with the emailed code",
        "tags": [
          "auth"
        ],
        "responses": {
          "200": {
            "description": "Password updated",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          }
        }
      }
    },
    "/api/auth/signup": {
      "post": {
        "summary": "Create an account (email + name + password)",
        "tags": [
          "auth"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "email",
                  "password",
                  "name"
                ],
                "properties": {
                  "email": {
                    "type": "string",
                    "format": "email"
                  },
                  "password": {
                    "type": "string",
                    "minLength": 8
                  },
                  "name": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Account created (no company yet)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/UserTokenResponse"
                }
              }
            }
          },
          "400": {
            "description": "Validation error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/call-tracking-categories": {
      "get": {
        "summary": null,
        "tags": [
          "call-tracking-categories"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": null,
        "tags": [
          "call-tracking-categories"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/call-tracking-categories/{id}": {
      "patch": {
        "summary": null,
        "tags": [
          "call-tracking-categories"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "delete": {
        "summary": null,
        "tags": [
          "call-tracking-categories"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/calls/history": {
      "get": {
        "summary": "List call history for the company",
        "tags": [
          "calls"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Call log entries",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/calls/history/{contactId}": {
      "get": {
        "summary": "List call history for one contact",
        "tags": [
          "calls"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "parameters": [
          {
            "name": "contactId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Call log entries for the contact",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/calls/log": {
      "post": {
        "summary": null,
        "tags": [
          "calls"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/calls/pending": {
      "get": {
        "summary": null,
        "tags": [
          "calls"
        ],
        "parameters": [
          {
            "name": "id",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "delete": {
        "summary": null,
        "tags": [
          "calls"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/calls/test": {
      "post": {
        "summary": null,
        "tags": [
          "calls"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/communication-logs": {
      "get": {
        "summary": "List communication logs (voice + sms + email) for the company",
        "tags": [
          "communication-logs"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
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
          },
          {
            "name": "type",
            "in": "query",
            "schema": {
              "type": "string",
              "enum": [
                "voice",
                "sms",
                "email"
              ]
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Communication log entries",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/communication-logs/{id}": {
      "get": {
        "summary": null,
        "tags": [
          "communication-logs"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "patch": {
        "summary": null,
        "tags": [
          "communication-logs"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/communication-logs/{id}/assign": {
      "put": {
        "summary": null,
        "tags": [
          "communication-logs"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/communication-logs/{id}/confirm": {
      "post": {
        "summary": null,
        "tags": [
          "communication-logs"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/communication-logs/{id}/fast-forward-timer": {
      "post": {
        "summary": null,
        "tags": [
          "communication-logs"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/communication-logs/assign": {
      "post": {
        "summary": null,
        "tags": [
          "communication-logs"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/communication-logs/by-comm-id/{commId}": {
      "get": {
        "summary": null,
        "tags": [
          "communication-logs"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/company/wipe-data": {
      "post": {
        "summary": null,
        "tags": [
          "company"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/company-members": {
      "get": {
        "summary": null,
        "tags": [
          "company-members"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/company-members/{id}": {
      "patch": {
        "summary": null,
        "tags": [
          "company-members"
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "role": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "delete": {
        "summary": null,
        "tags": [
          "company-members"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/company-numbers": {
      "get": {
        "summary": "List phone numbers assigned to the company",
        "tags": [
          "company",
          "numbers"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Assigned numbers",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": "Assign a phone number to the company",
        "tags": [
          "company",
          "numbers"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "phoneNumber"
                ],
                "properties": {
                  "phoneNumber": {
                    "type": "string",
                    "description": "E.164 format"
                  },
                  "telnyxPhoneNumberId": {
                    "type": "string"
                  },
                  "connectionLabel": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Number assigned",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/company-numbers/{id}": {
      "patch": {
        "summary": null,
        "tags": [
          "company-numbers"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "delete": {
        "summary": null,
        "tags": [
          "company-numbers"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/contacts": {
      "get": {
        "summary": "List contacts for the company",
        "tags": [
          "contacts"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Contacts",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": null,
        "tags": [
          "contacts"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/contacts/{id}": {
      "get": {
        "summary": null,
        "tags": [
          "contacts"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "put": {
        "summary": null,
        "tags": [
          "contacts"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "delete": {
        "summary": null,
        "tags": [
          "contacts"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/dashboard/recent-notifications": {
      "get": {
        "summary": null,
        "tags": [
          "dashboard"
        ],
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/dashboard/summary": {
      "get": {
        "summary": null,
        "tags": [
          "dashboard"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/debug-sse": {
      "get": {
        "summary": null,
        "tags": [
          "debug-sse"
        ],
        "parameters": [
          {
            "name": "companyId",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/email/history": {
      "get": {
        "summary": null,
        "tags": [
          "email"
        ],
        "parameters": [
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/email/history/{contactId}": {
      "get": {
        "summary": null,
        "tags": [
          "email"
        ],
        "parameters": [
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/email/send": {
      "post": {
        "summary": null,
        "tags": [
          "email"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/email-attachment/{commId}/{filename}": {
      "get": {
        "summary": null,
        "tags": [
          "email-attachment"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/emergency/{path}": {},
    "/api/events": {
      "get": {
        "summary": null,
        "tags": [
          "events"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/events/test": {
      "get": {
        "summary": null,
        "tags": [
          "events"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/fcm/store-token": {
      "post": {
        "summary": "Store an FCM token for the authenticated user",
        "tags": [
          "push"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Token stored",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/google/calendar/callback": {
      "get": {
        "summary": null,
        "tags": [
          "google"
        ],
        "parameters": [
          {
            "name": "code",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "state",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "error",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/google/calendar/connect": {
      "get": {
        "summary": null,
        "tags": [
          "google"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/invites": {
      "get": {
        "summary": null,
        "tags": [
          "invites"
        ],
        "parameters": [
          {
            "name": "companyId",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/invites/{id}": {
      "delete": {
        "summary": null,
        "tags": [
          "invites"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/invites/{id}/resend": {
      "post": {
        "summary": null,
        "tags": [
          "invites"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/ivr/flows": {
      "get": {
        "summary": null,
        "tags": [
          "ivr"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": null,
        "tags": [
          "ivr"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/ivr/flows/{flowId}/rules/{ruleId}": {
      "get": {
        "summary": null,
        "tags": [
          "ivr"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "patch": {
        "summary": null,
        "tags": [
          "ivr"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "delete": {
        "summary": null,
        "tags": [
          "ivr"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/ivr/flows/{id}": {
      "get": {
        "summary": null,
        "tags": [
          "ivr"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "patch": {
        "summary": null,
        "tags": [
          "ivr"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "delete": {
        "summary": null,
        "tags": [
          "ivr"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/ivr/flows/{id}/rules": {
      "get": {
        "summary": null,
        "tags": [
          "ivr"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": null,
        "tags": [
          "ivr"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/me": {
      "get": {
        "summary": "Get the authenticated user profile (id, name, email, company, role)",
        "tags": [
          "me"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Profile",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/User"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "put": {
        "summary": "Update name, email or avatar of the authenticated user",
        "tags": [
          "me"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string"
                  },
                  "email": {
                    "type": "string",
                    "format": "email"
                  },
                  "avatar": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Updated profile",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "$ref": "#/components/schemas/User"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/me/switch-company": {
      "post": {
        "summary": null,
        "tags": [
          "me"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/messages": {
      "post": {
        "summary": null,
        "tags": [
          "messages"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "get": {
        "summary": null,
        "tags": [
          "messages"
        ],
        "parameters": [
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "perPage",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "threadId",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "patch": {
        "summary": null,
        "tags": [
          "messages"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/messages/draft": {
      "post": {
        "summary": null,
        "tags": [
          "messages"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/notifications": {
      "get": {
        "summary": "List notifications for the company",
        "tags": [
          "notifications"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "parameters": [
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
            "description": "Notifications",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "patch": {
        "summary": null,
        "tags": [
          "notifications"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/notifications/{id}": {
      "get": {
        "summary": null,
        "tags": [
          "notifications"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/notifications/{id}/read": {
      "put": {
        "summary": null,
        "tags": [
          "notifications"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/notifications/{id}/reply": {
      "post": {
        "summary": null,
        "tags": [
          "notifications"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/notifications/draft": {
      "post": {
        "summary": null,
        "tags": [
          "notifications"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/notifications/mark-all-read": {
      "post": {
        "summary": null,
        "tags": [
          "notifications"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/notifications/unread-count": {
      "get": {
        "summary": "Unread notification count for the user",
        "tags": [
          "notifications"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Unread count",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/orchestrator/approvals/{id}": {
      "post": {
        "summary": null,
        "tags": [
          "orchestrator"
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "action": {
                    "type": "string"
                  },
                  "rejectReason": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/profiles": {
      "get": {
        "summary": null,
        "tags": [
          "profiles"
        ],
        "parameters": [
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "search",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": null,
        "tags": [
          "profiles"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/profiles/{id}": {
      "get": {
        "summary": null,
        "tags": [
          "profiles"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "put": {
        "summary": null,
        "tags": [
          "profiles"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "delete": {
        "summary": null,
        "tags": [
          "profiles"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/profiles/merge-candidates": {
      "get": {
        "summary": null,
        "tags": [
          "profiles"
        ],
        "parameters": [
          {
            "name": "status",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/profiles/merge-candidates/{id}": {
      "post": {
        "summary": "Resolve one merge candidate.",
        "tags": [
          "profiles"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/push/register": {
      "post": {
        "summary": "Register a device for push notifications (APNs/FCM tokens)",
        "tags": [
          "push"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "deviceId"
                ],
                "properties": {
                  "deviceId": {
                    "type": "string"
                  },
                  "platform": {
                    "type": "string",
                    "enum": [
                      "ios",
                      "android",
                      "web"
                    ]
                  },
                  "fcmToken": {
                    "type": "string"
                  },
                  "voipToken": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Device registered",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/push/register-token": {
      "post": {
        "summary": "POST /api/push/register-token — upsert FCM / VoIP token for the current user (session).",
        "tags": [
          "push"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "delete": {
        "summary": "POST /api/push/register-token — upsert FCM / VoIP token for the current user (session).",
        "tags": [
          "push"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/push/unregister": {
      "delete": {
        "summary": null,
        "tags": [
          "push"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/recording/{logId}": {
      "get": {
        "summary": null,
        "tags": [
          "recording"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/representatives": {
      "get": {
        "summary": null,
        "tags": [
          "representatives"
        ],
        "parameters": [
          {
            "name": "search",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/representatives/{id}": {
      "get": {
        "summary": null,
        "tags": [
          "representatives"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/representatives/{id}/communication-logs": {
      "get": {
        "summary": null,
        "tags": [
          "representatives"
        ],
        "parameters": [
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/schedule/events": {
      "get": {
        "summary": null,
        "tags": [
          "schedule"
        ],
        "parameters": [
          {
            "name": "startDate",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "endDate",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": null,
        "tags": [
          "schedule"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/schedule/events/{id}": {
      "put": {
        "summary": null,
        "tags": [
          "schedule"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "delete": {
        "summary": null,
        "tags": [
          "schedule"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/shortcuts/personal": {
      "get": {
        "summary": null,
        "tags": [
          "shortcuts"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": null,
        "tags": [
          "shortcuts"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/shortcuts/personal/{id}": {
      "delete": {
        "summary": null,
        "tags": [
          "shortcuts"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/shortcuts/team": {
      "get": {
        "summary": null,
        "tags": [
          "shortcuts"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/sip/credentials": {
      "get": {
        "summary": "Get Telnyx WebRTC connection config + short-lived token for the dialer",
        "description": "Returns connectionId, callerIdName, callerIdNumber and a short-lived webrtcToken for the Telnyx WebRTC SDK. The dialer authenticates with this token, not the API key.",
        "tags": [
          "telnyx",
          "dialer"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "WebRTC credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SipCredentials"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/sms/history": {
      "get": {
        "summary": "List SMS history for the company",
        "tags": [
          "sms"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
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
            "description": "SMS log entries",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/sms/history/{contactId}": {
      "get": {
        "summary": "List SMS history for one contact",
        "tags": [
          "sms"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "parameters": [
          {
            "name": "contactId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "SMS log entries for the contact",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/sms/send": {
      "post": {
        "summary": "Send an SMS to one or more recipients",
        "tags": [
          "sms"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "recipients",
                  "message"
                ],
                "properties": {
                  "recipients": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "description": "Phone numbers"
                  },
                  "message": {
                    "type": "string"
                  },
                  "fromNumber": {
                    "type": "string",
                    "description": "Defaults to the company number"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Send result per recipient",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "data": {
                      "type": "object",
                      "properties": {
                        "results": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "properties": {
                              "recipient": {
                                "type": "string"
                              },
                              "messageId": {
                                "type": "string"
                              },
                              "status": {
                                "type": "string",
                                "enum": [
                                  "sent",
                                  "failed"
                                ]
                              },
                              "error": {
                                "type": "string"
                              }
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
          "400": {
            "description": "recipients and message are required",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/tasks": {
      "get": {
        "summary": null,
        "tags": [
          "tasks"
        ],
        "parameters": [
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "contactId",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "assignedToId",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "status",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": null,
        "tags": [
          "tasks"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/tasks/{id}": {
      "get": {
        "summary": null,
        "tags": [
          "tasks"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "put": {
        "summary": null,
        "tags": [
          "tasks"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "delete": {
        "summary": null,
        "tags": [
          "tasks"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx": {
      "post": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "message": {
                    "type": "string"
                  },
                  "phoneNumber": {
                    "type": "string"
                  },
                  "threadId": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/answer-call": {
      "post": {
        "summary": "Answer an inbound call by its Telnyx call_control_id",
        "tags": [
          "telnyx",
          "dialer"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Call answered",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/call-webhook": {
      "post": {
        "summary": "Tracks transfer legs back to the original caller.",
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "get": {
        "summary": "Tracks transfer legs back to the original caller.",
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "put": {
        "summary": "Tracks transfer legs back to the original caller.",
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/dial": {
      "post": {
        "summary": "Place an outbound call through Telnyx (server-side call control)",
        "tags": [
          "telnyx",
          "dialer"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "to"
                ],
                "properties": {
                  "to": {
                    "type": "string",
                    "description": "Destination phone number"
                  },
                  "from": {
                    "type": "string",
                    "description": "Caller ID override (defaults to company number)"
                  },
                  "clientId": {
                    "type": "string"
                  },
                  "commId": {
                    "type": "string"
                  },
                  "leg": {
                    "type": "string",
                    "default": "outbound_dial"
                  },
                  "priority": {
                    "type": "string",
                    "default": "normal"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Call initiated",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "callId": {
                      "type": "string",
                      "description": "Telnyx call_control_id"
                    },
                    "callLegId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Missing number / no company number assigned",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/hangup": {
      "post": {
        "summary": "Hang up a call by its Telnyx call_control_id",
        "tags": [
          "telnyx",
          "dialer"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "callId"
                ],
                "properties": {
                  "callId": {
                    "type": "string",
                    "description": "Telnyx call_control_id returned by POST /api/telnyx/dial"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Hangup requested",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/ivr/bridge": {
      "post": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "call_control_id": {
                    "type": "string"
                  },
                  "other_call_control_id": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/ivr/flows": {
      "get": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/ivr/gather": {
      "post": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "call_control_id": {
                    "type": "string"
                  },
                  "audio_url": {
                    "type": "string"
                  },
                  "invalid_audio_url": {
                    "type": "string"
                  },
                  "timeout_millis": {
                    "type": "string"
                  },
                  "minimum_digits": {
                    "type": "string"
                  },
                  "maximum_digits": {
                    "type": "string"
                  },
                  "terminating_digit": {
                    "type": "string"
                  },
                  "finish_on_key": {
                    "type": "string"
                  },
                  "client_state": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/ivr/speak": {
      "post": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "call_control_id": {
                    "type": "string"
                  },
                  "text": {
                    "type": "string"
                  },
                  "voice": {
                    "type": "string"
                  },
                  "language": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/log-webrtc-call": {
      "post": {
        "summary": "Log a WebRTC dialer call into the call log / communication log",
        "tags": [
          "telnyx",
          "dialer"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Call logged",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/numbers/{phone_number_id}": {
      "delete": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/numbers/buy": {
      "post": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "phone_numbers": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/numbers/list": {
      "get": {
        "summary": "List Telnyx numbers owned by the account",
        "tags": [
          "telnyx",
          "numbers"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "Number list",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/numbers/orders": {
      "get": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "parameters": [
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/numbers/search": {
      "get": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "parameters": [
          {
            "name": "country_code",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "area_code",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "phone_number",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "features",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/numbers/update": {
      "post": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/porting/check": {
      "post": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "phone_numbers": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/porting/loa-configurations": {
      "get": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/porting/orders": {
      "post": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "get": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "parameters": [
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/setup-company": {
      "post": {
        "summary": "POST /api/telnyx/setup-company",
        "tags": [
          "telnyx"
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "get": {
        "summary": "POST /api/telnyx/setup-company",
        "tags": [
          "telnyx"
        ],
        "parameters": [
          {
            "name": "companyId",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/test": {
      "get": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/test-call": {
      "post": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "get": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "parameters": [
          {
            "name": "from",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "to",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/test-call-end": {
      "post": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "get": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "parameters": [
          {
            "name": "callId",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/test-call-summary": {
      "post": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "threadId": {
                    "type": "string"
                  },
                  "duration": {
                    "type": "string"
                  },
                  "estimated_price": {
                    "type": "string"
                  },
                  "summary": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "security": [
          {
            "bearerAuth": []
          },
          {
            "cookieAuth": []
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/test-webhook": {
      "get": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "parameters": [
          {
            "name": "from",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "text",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "to",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/verified-numbers": {
      "get": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "parameters": [
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "search",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "phone_number": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/verified-numbers/verify": {
      "post": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "phone_number": {
                    "type": "string"
                  },
                  "verification_code": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/webhook": {
      "post": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "get": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "put": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/telnyx/webhook-backup": {
      "post": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "get": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "put": {
        "summary": null,
        "tags": [
          "telnyx"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/test-prompt": {
      "get": {
        "summary": "Dry-run harness: inject a voicemail transcript into the pipeline WITHOUT a phone.",
        "tags": [
          "test-prompt"
        ],
        "parameters": [
          {
            "name": "transcript",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "digit",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "phone",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/track/click": {
      "get": {
        "summary": null,
        "tags": [
          "track"
        ],
        "parameters": [
          {
            "name": "t",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "url",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/track/open": {
      "get": {
        "summary": null,
        "tags": [
          "track"
        ],
        "parameters": [
          {
            "name": "t",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/upload/avatar": {
      "post": {
        "summary": null,
        "tags": [
          "upload"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/upload/ivr": {
      "post": {
        "summary": null,
        "tags": [
          "upload"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/upload/logo": {
      "post": {
        "summary": null,
        "tags": [
          "upload"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/telemetry/events": {
      "post": {
        "summary": null,
        "tags": [
          "v1"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/tenants/{tenantSlug}/clear": {
      "post": {
        "summary": null,
        "tags": [
          "v1"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/tenants/{tenantSlug}/events": {
      "get": {
        "summary": null,
        "tags": [
          "v1"
        ],
        "parameters": [
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "eventType",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "sessionId",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/tenants/{tenantSlug}/profiles": {
      "get": {
        "summary": null,
        "tags": [
          "v1"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/tenants/{tenantSlug}/profiles/{id}": {
      "get": {
        "summary": null,
        "tags": [
          "v1"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/tenants/{tenantSlug}/profiles/{id}/history": {
      "get": {
        "summary": null,
        "tags": [
          "v1"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/tenants/{tenantSlug}/profiles/{id}/representative": {
      "put": {
        "summary": null,
        "tags": [
          "v1"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/webhooks/facebook": {
      "get": {
        "summary": "Facebook reciprocal follow-back (Epic 7, T7.4).",
        "tags": [
          "webhooks"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": "Facebook reciprocal follow-back (Epic 7, T7.4).",
        "tags": [
          "webhooks"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/webhooks/inbound-email": {
      "post": {
        "summary": "Handle POST request from inbound email gateway.",
        "tags": [
          "webhooks"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/webhooks/telnyx": {
      "post": {
        "summary": null,
        "tags": [
          "webhooks"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/webhooks/telnyx/incoming-call": {
      "post": {
        "summary": "ClearSky spec alias: Telnyx can point voice webhook here.",
        "tags": [
          "webhooks"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/webhooks/telnyx/incoming-sms": {
      "post": {
        "summary": "ClearSky spec alias: Telnyx can point messaging webhook here.",
        "tags": [
          "webhooks"
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DataEnvelope"
                }
              }
            }
          },
          "500": {
            "description": "Server error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "bearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT"
      },
      "cookieAuth": {
        "type": "apiKey",
        "in": "cookie",
        "name": "app_session"
      }
    },
    "schemas": {
      "Error": {
        "type": "object",
        "required": [
          "success",
          "error"
        ],
        "properties": {
          "success": {
            "type": "boolean"
          },
          "error": {
            "type": "string"
          },
          "code": {
            "type": "integer"
          }
        }
      },
      "Success": {
        "type": "object",
        "required": [
          "success"
        ],
        "properties": {
          "success": {
            "type": "boolean"
          }
        }
      },
      "DataEnvelope": {
        "type": "object",
        "properties": {
          "success": {
            "type": "boolean"
          },
          "data": {
            "additionalProperties": true
          }
        }
      },
      "Company": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "ownerId": {
            "type": "string"
          },
          "emailSlug": {
            "type": "string"
          },
          "logo": {
            "type": "string"
          }
        }
      },
      "User": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "email": {
            "type": "string",
            "format": "email"
          },
          "name": {
            "type": "string"
          },
          "role": {
            "type": "string"
          },
          "platformRole": {
            "type": "string"
          },
          "verified": {
            "type": "boolean"
          },
          "avatar": {
            "type": "string"
          },
          "company": {
            "$ref": "#/components/schemas/Company"
          }
        }
      },
      "UserTokenResponse": {
        "type": "object",
        "properties": {
          "success": {
            "type": "boolean"
          },
          "token": {
            "type": "string"
          },
          "user": {
            "$ref": "#/components/schemas/User"
          }
        }
      },
      "CompanyPhoneNumber": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "companyId": {
            "type": "string"
          },
          "phoneNumber": {
            "type": "string"
          },
          "telnyxPhoneNumberId": {
            "type": "string"
          },
          "connectionLabel": {
            "type": "string"
          },
          "callFlowId": {
            "type": "string"
          },
          "callTrackingCategoryId": {
            "type": "string"
          }
        }
      },
      "Contact": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "companyId": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "phone": {
            "type": "string"
          },
          "email": {
            "type": "string"
          },
          "landline": {
            "type": "string"
          },
          "cell": {
            "type": "string"
          },
          "smsPermission": {
            "type": "boolean"
          },
          "contactType": {
            "type": "string"
          },
          "avatarUrl": {
            "type": "string"
          }
        }
      },
      "SipCredentials": {
        "type": "object",
        "properties": {
          "success": {
            "type": "boolean"
          },
          "data": {
            "type": "object",
            "properties": {
              "connectionId": {
                "type": "string"
              },
              "callerIdName": {
                "type": "string"
              },
              "callerIdNumber": {
                "type": "string"
              },
              "webrtcToken": {
                "type": "string",
                "description": "Short-lived JWT for the Telnyx WebRTC SDK"
              }
            }
          }
        }
      }
    }
  }
};
