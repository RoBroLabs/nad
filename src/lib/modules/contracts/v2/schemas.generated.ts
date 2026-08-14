/** Generated from the canonical NAD v2 JSON Schemas. Do not edit. */
export const CONTRACT_V2_SHA256 = '90a0de576b7fc242a091b092ab4d41be85e5627133960ca93df3b2f5e1109386' as const;
export const contractV2Lock = {
  "schemaVersion": 2,
  "contractVersion": "2.0",
  "packageSchemaVersion": 2,
  "hostApiVersion": "2.0",
  "hostApiCompatibility": "2.x",
  "uiApiVersion": "2.0",
  "uiApiCompatibility": "2.x",
  "capabilities": [
    "connections.current",
    "connections.get",
    "http.request",
    "notifications.emit",
    "storage.get",
    "storage.set",
    "storage.delete",
    "diagnostics.emit",
    "audit.annotate",
    "apps.invoke"
  ],
  "supportedPackageSchemaVersions": [
    1,
    2
  ],
  "sha256": "90a0de576b7fc242a091b092ab4d41be85e5627133960ca93df3b2f5e1109386",
  "files": {
    "collection.v1.schema.json": "a076a20ed403db10b3f135679a3b59b1b1aa6a74407c71ed1639829ff76cb2a7",
    "connection-schema.v2.schema.json": "4f195bf7611b58139d435f67c998e1995b29812ca75f87c57f5e6dd3a4241b4b",
    "host-call.v2.schema.json": "b33c3e526552040ba3faba0aad62483cf3dcaffafd02a318aa301292a5aadeeb",
    "host-response.v2.schema.json": "167885a70562db9a7948091c795aab3ce7778caef7ce37365beaae92c74d6626",
    "http-access.v2.schema.json": "98bbebe6e2c15714fea8b0a6e26f44b21ab1afd47f4d005b13368adab8c22420",
    "invocation-request.v2.schema.json": "58d3947557cf586bee17d5577834a734bc539a3ed839d19c0408d250a2b9cead",
    "manifest.v2.schema.json": "04aa0018c7743b23ed7b034ac45481f0d3333ab6f5c743e69c2a4a15dde203fa",
    "operation.v2.schema.json": "bde8a0ef64005d79378f491007925584609cbc66ae31327f34388895a7aa7d33",
    "release-record.v2.schema.json": "cb462e47808d0b57dd36a2b02f24d2c03e64927b3e0c1fc8a32bec31f01d974e",
    "review-attestation.v1.schema.json": "43329a8f5ed3997cef4206a9d7ce31a523db6d9419cbd88208215bd18a83f820",
    "ui-bridge-connect.v2.schema.json": "b7d3778f869adb6f7029421393dd1cec5479c9003cd0f079dba1bdd75cb09cf8",
    "ui-bridge-message.v2.schema.json": "ee10a76328ab6378c1904ccab5b57b218da1a61af9f766eed34bd44c7ad1eacb",
    "ui-surfaces.v2.schema.json": "7ddab68b60181e427f344d3fe07def8a5997f90e1ca7bf54c2c45f1eb4574728"
  }
} as const;
export const contractV2Schemas = {
  "collection.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/marketplace/collection.v1.schema.json",
    "title": "NAD Marketplace Collection",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schemaVersion",
      "collection"
    ],
    "properties": {
      "schemaVersion": {
        "const": 1
      },
      "collection": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "slug",
          "name",
          "summary",
          "description",
          "category",
          "publisher",
          "firstParty",
          "packages"
        ],
        "properties": {
          "kind": {
            "const": "collection"
          },
          "id": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9-]*)+$"
          },
          "slug": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9-]{0,63}$"
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "summary": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "description": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1000
          },
          "category": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "publisher": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "firstParty": {
            "type": "boolean"
          },
          "packages": {
            "type": "array",
            "minItems": 1,
            "maxItems": 64,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "slug",
                "required",
                "selectedByDefault"
              ],
              "properties": {
                "packageId": {
                  "type": "string",
                  "pattern": "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9-]*)+$"
                },
                "slug": {
                  "type": "string",
                  "pattern": "^[a-z0-9][a-z0-9-]{0,63}$"
                },
                "version": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80
                },
                "required": {
                  "type": "boolean"
                },
                "selectedByDefault": {
                  "type": "boolean"
                },
                "note": {
                  "type": "string",
                  "maxLength": 300
                }
              }
            }
          },
          "workspaceTemplate": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "name",
              "description",
              "tabs"
            ],
            "properties": {
              "name": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80
              },
              "description": {
                "type": "string",
                "minLength": 1,
                "maxLength": 500
              },
              "tabs": {
                "type": "array",
                "minItems": 1,
                "maxItems": 16,
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "name",
                    "items"
                  ],
                  "properties": {
                    "name": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 80
                    },
                    "items": {
                      "type": "array",
                      "maxItems": 64,
                      "items": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "packageSlug",
                          "surfaceId"
                        ],
                        "properties": {
                          "packageSlug": {
                            "type": "string",
                            "pattern": "^[a-z0-9][a-z0-9-]{0,63}$"
                          },
                          "surfaceId": {
                            "type": "string",
                            "pattern": "^[a-z0-9][a-z0-9-]{0,63}$"
                          },
                          "connectionSlot": {
                            "type": "string",
                            "pattern": "^[a-z][a-z0-9-]{0,63}$"
                          },
                          "x": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 11
                          },
                          "y": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 10000
                          },
                          "w": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 12
                          },
                          "h": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 24
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
      }
    }
  },
  "connection-schema.v2.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/package/v2/connection-schema.v2.schema.json",
    "title": "NAD v2 connection profile schema",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "$schema",
      "type",
      "additionalProperties",
      "properties"
    ],
    "properties": {
      "$schema": {
        "const": "https://json-schema.org/draft/2020-12/schema"
      },
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 160
      },
      "description": {
        "type": "string",
        "maxLength": 500
      },
      "type": {
        "const": "object"
      },
      "additionalProperties": {
        "const": false
      },
      "required": {
        "type": "array",
        "maxItems": 64,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9_-]{0,63}$"
        }
      },
      "properties": {
        "type": "object",
        "maxProperties": 64,
        "propertyNames": {
          "pattern": "^[a-z][a-z0-9_-]{0,63}$"
        },
        "additionalProperties": {
          "$ref": "#/$defs/field"
        }
      }
    },
    "$defs": {
      "field": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "type",
          "title",
          "x-nad"
        ],
        "properties": {
          "type": {
            "enum": [
              "string",
              "number",
              "integer",
              "boolean"
            ]
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "description": {
            "type": "string",
            "maxLength": 300
          },
          "minLength": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000000
          },
          "maxLength": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000000
          },
          "minimum": {
            "type": "number"
          },
          "maximum": {
            "type": "number"
          },
          "pattern": {
            "type": "string",
            "maxLength": 500
          },
          "enum": {
            "type": "array",
            "minItems": 1,
            "maxItems": 100,
            "uniqueItems": true,
            "items": {
              "type": [
                "string",
                "number",
                "boolean"
              ]
            }
          },
          "default": {
            "type": [
              "string",
              "number",
              "boolean"
            ]
          },
          "x-nad": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "control"
            ],
            "properties": {
              "control": {
                "enum": [
                  "text",
                  "url",
                  "secret",
                  "number",
                  "boolean",
                  "select"
                ]
              },
              "placeholder": {
                "type": "string",
                "maxLength": 200
              },
              "options": {
                "type": "array",
                "minItems": 1,
                "maxItems": 100,
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "label",
                    "value"
                  ],
                  "properties": {
                    "label": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 80
                    },
                    "value": {
                      "type": "string",
                      "maxLength": 200
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
  "host-call.v2.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/package/v2/host-call.v2.schema.json",
    "title": "NAD Host API v2 call",
    "oneOf": [
      {
        "$ref": "#/$defs/connectionsCurrent"
      },
      {
        "$ref": "#/$defs/connectionsGet"
      },
      {
        "$ref": "#/$defs/httpRequest"
      },
      {
        "$ref": "#/$defs/notification"
      },
      {
        "$ref": "#/$defs/storageGet"
      },
      {
        "$ref": "#/$defs/storageSet"
      },
      {
        "$ref": "#/$defs/storageDelete"
      },
      {
        "$ref": "#/$defs/diagnostic"
      },
      {
        "$ref": "#/$defs/audit"
      },
      {
        "$ref": "#/$defs/appInvoke"
      }
    ],
    "$defs": {
      "emptyParams": {
        "type": "object",
        "additionalProperties": false
      },
      "storageKey": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "key"
        ],
        "properties": {
          "key": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_.:-]{1,120}$"
          }
        }
      },
      "connectionsCurrent": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "method",
          "params"
        ],
        "properties": {
          "method": {
            "const": "connections.current"
          },
          "params": {
            "$ref": "#/$defs/emptyParams"
          }
        }
      },
      "connectionsGet": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "method",
          "params"
        ],
        "properties": {
          "method": {
            "const": "connections.get"
          },
          "params": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "name"
            ],
            "properties": {
              "name": {
                "type": "string",
                "pattern": "^[a-z][a-z0-9_-]{0,63}$"
              }
            }
          }
        }
      },
      "httpRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "method",
          "params"
        ],
        "properties": {
          "method": {
            "const": "http.request"
          },
          "params": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "scope"
            ],
            "properties": {
              "scope": {
                "type": "string",
                "pattern": "^[a-z][a-z0-9-]{0,63}$"
              },
              "method": {
                "enum": [
                  "GET",
                  "POST",
                  "PUT",
                  "DELETE"
                ]
              },
              "pathParameters": {
                "type": "object",
                "maxProperties": 8,
                "additionalProperties": {
                  "type": [
                    "string",
                    "number"
                  ]
                }
              },
              "query": {
                "type": "object",
                "maxProperties": 16,
                "additionalProperties": {
                  "type": "string",
                  "maxLength": 1024
                }
              },
              "headers": {
                "type": "object",
                "maxProperties": 8,
                "additionalProperties": {
                  "type": "string",
                  "maxLength": 512
                }
              },
              "body": {}
            }
          }
        }
      },
      "notification": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "method",
          "params"
        ],
        "properties": {
          "method": {
            "const": "notifications.emit"
          },
          "params": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "key",
              "severity",
              "title",
              "body"
            ],
            "properties": {
              "key": {
                "type": "string",
                "minLength": 1,
                "maxLength": 120
              },
              "severity": {
                "enum": [
                  "info",
                  "warning",
                  "critical"
                ]
              },
              "title": {
                "type": "string",
                "minLength": 1,
                "maxLength": 160
              },
              "body": {
                "type": "string",
                "minLength": 1,
                "maxLength": 2000
              },
              "dedupeKey": {
                "type": "string",
                "minLength": 1,
                "maxLength": 160
              }
            }
          }
        }
      },
      "storageGet": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "method",
          "params"
        ],
        "properties": {
          "method": {
            "const": "storage.get"
          },
          "params": {
            "$ref": "#/$defs/storageKey"
          }
        }
      },
      "storageSet": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "method",
          "params"
        ],
        "properties": {
          "method": {
            "const": "storage.set"
          },
          "params": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "key",
              "value"
            ],
            "properties": {
              "key": {
                "type": "string",
                "pattern": "^[A-Za-z0-9_.:-]{1,120}$"
              },
              "value": {}
            }
          }
        }
      },
      "storageDelete": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "method",
          "params"
        ],
        "properties": {
          "method": {
            "const": "storage.delete"
          },
          "params": {
            "$ref": "#/$defs/storageKey"
          }
        }
      },
      "diagnostic": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "method",
          "params"
        ],
        "properties": {
          "method": {
            "const": "diagnostics.emit"
          },
          "params": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "level",
              "code",
              "message"
            ],
            "properties": {
              "level": {
                "enum": [
                  "debug",
                  "info",
                  "warning",
                  "error"
                ]
              },
              "code": {
                "type": "string",
                "pattern": "^[A-Z][A-Z0-9_]{0,79}$"
              },
              "message": {
                "type": "string",
                "minLength": 1,
                "maxLength": 500
              },
              "metadata": {
                "type": "object",
                "maxProperties": 16,
                "propertyNames": {
                  "pattern": "^[A-Za-z0-9_.:-]{1,80}$"
                },
                "additionalProperties": {
                  "type": [
                    "string",
                    "number",
                    "boolean",
                    "null"
                  ]
                }
              }
            }
          }
        }
      },
      "audit": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "method",
          "params"
        ],
        "properties": {
          "method": {
            "const": "audit.annotate"
          },
          "params": {
            "type": "object",
            "maxProperties": 16,
            "propertyNames": {
              "pattern": "^[A-Za-z0-9_.:-]{1,80}$"
            },
            "additionalProperties": {
              "type": [
                "string",
                "number",
                "boolean",
                "null"
              ]
            }
          }
        }
      },
      "appInvoke": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "method",
          "params"
        ],
        "properties": {
          "method": {
            "const": "apps.invoke"
          },
          "params": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "dependency",
              "operation",
              "connectionProfileId",
              "input"
            ],
            "properties": {
              "dependency": {
                "type": "string",
                "pattern": "^[a-z][a-z0-9-]{0,63}$"
              },
              "operation": {
                "type": "string",
                "pattern": "^[a-z][a-z0-9.-]{0,79}$"
              },
              "connectionProfileId": {
                "type": "string",
                "pattern": "^[A-Za-z0-9_-]{16,128}$"
              },
              "input": {}
            }
          }
        }
      }
    }
  },
  "host-response.v2.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/package/v2/host-response.v2.schema.json",
    "title": "NAD Host API v2 response envelope",
    "oneOf": [
      {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "ok",
          "result"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "result": {}
        }
      },
      {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "ok",
          "error"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "error": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "code",
              "message"
            ],
            "properties": {
              "code": {
                "type": "string",
                "pattern": "^[A-Z][A-Z0-9_]{0,79}$"
              },
              "message": {
                "type": "string",
                "minLength": 1,
                "maxLength": 500
              },
              "retryable": {
                "type": "boolean"
              }
            }
          }
        }
      }
    ]
  },
  "http-access.v2.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/package/v2/http-access.v2.schema.json",
    "title": "NAD v2 scoped HTTP access",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "id",
      "scheme",
      "hostField",
      "path",
      "methods",
      "effect"
    ],
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9-]{0,63}$"
      },
      "scheme": {
        "enum": [
          "http",
          "https"
        ]
      },
      "hostField": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9_-]{0,63}$"
      },
      "port": {
        "type": "integer",
        "minimum": 1,
        "maximum": 65535
      },
      "portField": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9_-]{0,63}$"
      },
      "path": {
        "type": "string",
        "minLength": 1,
        "maxLength": 2048,
        "pattern": "^/[^?#]*$"
      },
      "pathParameters": {
        "type": "object",
        "maxProperties": 8,
        "propertyNames": {
          "pattern": "^[A-Za-z][A-Za-z0-9_]{0,31}$"
        },
        "additionalProperties": {
          "enum": [
            "segment",
            "integer"
          ]
        }
      },
      "methods": {
        "type": "array",
        "minItems": 1,
        "maxItems": 4,
        "uniqueItems": true,
        "items": {
          "enum": [
            "GET",
            "POST",
            "PUT",
            "DELETE"
          ]
        }
      },
      "effect": {
        "enum": [
          "read",
          "write"
        ]
      },
      "requestBodyPolicy": {
        "enum": [
          "graphql-query",
          "credential-only",
          "session-cleanup"
        ]
      },
      "allowedHeaders": {
        "type": "array",
        "maxItems": 8,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^[A-Za-z0-9-]+$",
          "maxLength": 80
        }
      },
      "queryParameters": {
        "type": "array",
        "maxItems": 16,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^[A-Za-z0-9_.~-]+$",
          "maxLength": 80
        }
      },
      "credential": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "field",
          "location",
          "name"
        ],
        "properties": {
          "field": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9_-]{0,63}$"
          },
          "location": {
            "enum": [
              "header",
              "query",
              "json-body"
            ]
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[A-Za-z0-9_.~-]+$"
          },
          "prefix": {
            "type": "string",
            "maxLength": 128
          },
          "publicField": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9_-]{0,63}$"
          },
          "separator": {
            "type": "string",
            "maxLength": 16
          }
        }
      },
      "tlsVerifyField": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9_-]{0,63}$"
      }
    },
    "not": {
      "required": [
        "port",
        "portField"
      ]
    }
  },
  "invocation-request.v2.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/package/v2/invocation-request.v2.schema.json",
    "title": "NAD Host API v2 operation invocation",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "operation",
      "context"
    ],
    "properties": {
      "operation": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9.-]{0,79}$"
      },
      "body": {},
      "context": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "caller"
        ],
        "properties": {
          "connectionProfile": {
            "type": [
              "object",
              "null"
            ],
            "additionalProperties": false,
            "required": [
              "id",
              "name"
            ],
            "properties": {
              "id": {
                "type": "string",
                "pattern": "^[A-Za-z0-9_-]{16,128}$"
              },
              "name": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80
              }
            }
          },
          "caller": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind",
              "packageId"
            ],
            "properties": {
              "kind": {
                "enum": [
                  "core",
                  "app",
                  "addon",
                  "surface"
                ]
              },
              "packageId": {
                "type": "string",
                "maxLength": 160
              },
              "surfaceId": {
                "type": "string",
                "maxLength": 64
              }
            }
          }
        }
      }
    }
  },
  "manifest.v2.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/package/v2/manifest.v2.schema.json",
    "title": "NAD v2 App or Add-on manifest",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schemaVersion",
      "kind",
      "id",
      "slug",
      "name",
      "description",
      "icon",
      "category",
      "version",
      "publisher",
      "compatibility",
      "capabilities",
      "permissions",
      "surfaces"
    ],
    "properties": {
      "schemaVersion": {
        "const": 2
      },
      "kind": {
        "enum": [
          "app",
          "addon"
        ]
      },
      "id": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9-]*)+$"
      },
      "slug": {
        "type": "string",
        "pattern": "^[a-z0-9][a-z0-9-]{0,63}$"
      },
      "name": {
        "type": "string",
        "minLength": 1,
        "maxLength": 80
      },
      "description": {
        "type": "string",
        "minLength": 1,
        "maxLength": 300
      },
      "icon": {
        "type": "string",
        "minLength": 1,
        "maxLength": 64
      },
      "category": {
        "enum": [
          "servers",
          "media",
          "games",
          "network",
          "tools",
          "automation",
          "monitoring",
          "custom"
        ]
      },
      "version": {
        "type": "string",
        "pattern": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:[-+][0-9A-Za-z.-]+)?$"
      },
      "publisher": {
        "type": "string",
        "minLength": 1,
        "maxLength": 80
      },
      "compatibility": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "core",
          "hostApi",
          "uiApi"
        ],
        "properties": {
          "core": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "hostApi": {
            "type": "string",
            "minLength": 1,
            "maxLength": 20
          },
          "uiApi": {
            "type": "string",
            "minLength": 1,
            "maxLength": 20
          }
        }
      },
      "capabilities": {
        "type": "array",
        "maxItems": 16,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "name",
            "reason"
          ],
          "properties": {
            "name": {
              "enum": [
                "connections.current",
                "connections.get",
                "http.request",
                "notifications.emit",
                "storage.get",
                "storage.set",
                "storage.delete",
                "diagnostics.emit",
                "audit.annotate",
                "apps.invoke"
              ]
            },
            "reason": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            }
          }
        }
      },
      "permissions": {
        "type": "array",
        "minItems": 1,
        "maxItems": 32,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "action",
            "label",
            "risk"
          ],
          "properties": {
            "action": {
              "type": "string",
              "pattern": "^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+)*$"
            },
            "label": {
              "type": "string",
              "minLength": 1,
              "maxLength": 80
            },
            "risk": {
              "enum": [
                "read",
                "write",
                "admin"
              ]
            },
            "description": {
              "type": "string",
              "maxLength": 200
            }
          }
        }
      },
      "connections": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "schema",
          "multiple"
        ],
        "properties": {
          "schema": {
            "const": "schemas/connections.json"
          },
          "multiple": {
            "const": true
          },
          "testOperation": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9.-]{0,79}$"
          }
        }
      },
      "httpAccess": {
        "type": "array",
        "minItems": 1,
        "maxItems": 32,
        "items": {
          "$ref": "http-access.v2.schema.json"
        }
      },
      "dependencies": {
        "type": "array",
        "minItems": 1,
        "maxItems": 16,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "alias",
            "appId",
            "packageVersion",
            "operations"
          ],
          "properties": {
            "alias": {
              "type": "string",
              "pattern": "^[a-z][a-z0-9-]{0,63}$"
            },
            "appId": {
              "type": "string",
              "pattern": "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9-]*)+$"
            },
            "packageVersion": {
              "type": "string",
              "minLength": 1,
              "maxLength": 80
            },
            "operations": {
              "type": "object",
              "minProperties": 1,
              "maxProperties": 32,
              "propertyNames": {
                "pattern": "^[a-z][a-z0-9.-]{0,79}$"
              },
              "additionalProperties": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80
              }
            }
          }
        }
      },
      "operations": {
        "type": "object",
        "minProperties": 1,
        "maxProperties": 64,
        "propertyNames": {
          "pattern": "^[a-z][a-z0-9.-]{0,79}$"
        },
        "additionalProperties": {
          "$ref": "operation.v2.schema.json"
        }
      },
      "surfaces": {
        "const": "ui/surfaces.json"
      }
    },
    "allOf": [
      {
        "if": {
          "properties": {
            "kind": {
              "const": "app"
            }
          },
          "required": [
            "kind"
          ]
        },
        "then": {
          "not": {
            "required": [
              "dependencies"
            ]
          }
        },
        "else": {
          "required": [
            "dependencies"
          ],
          "properties": {
            "capabilities": {
              "type": "array",
              "contains": {
                "type": "object",
                "properties": {
                  "name": {
                    "const": "apps.invoke"
                  }
                },
                "required": [
                  "name"
                ]
              }
            }
          },
          "not": {
            "anyOf": [
              {
                "required": [
                  "connections"
                ]
              },
              {
                "required": [
                  "httpAccess"
                ]
              }
            ]
          }
        }
      },
      {
        "if": {
          "properties": {
            "capabilities": {
              "type": "array",
              "contains": {
                "type": "object",
                "properties": {
                  "name": {
                    "const": "http.request"
                  }
                },
                "required": [
                  "name"
                ]
              }
            }
          }
        },
        "then": {
          "required": [
            "connections",
            "httpAccess"
          ]
        },
        "else": {
          "not": {
            "required": [
              "httpAccess"
            ]
          }
        }
      }
    ]
  },
  "operation.v2.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/package/v2/operation.v2.schema.json",
    "title": "NAD v2 App operation",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "version",
      "kind",
      "consumers",
      "connection",
      "permission",
      "handler",
      "requestSchema",
      "responseSchema",
      "timeoutClass",
      "maxRequestBytes",
      "maxResponseBytes"
    ],
    "properties": {
      "version": {
        "type": "string",
        "pattern": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:[-+][0-9A-Za-z.-]+)?$"
      },
      "kind": {
        "enum": [
          "query",
          "mutation"
        ]
      },
      "consumers": {
        "type": "array",
        "minItems": 1,
        "maxItems": 2,
        "uniqueItems": true,
        "items": {
          "enum": [
            "self",
            "addon"
          ]
        }
      },
      "connection": {
        "enum": [
          "required",
          "optional",
          "none"
        ]
      },
      "permission": {
        "type": "string",
        "minLength": 1,
        "maxLength": 80
      },
      "handler": {
        "type": "string",
        "pattern": "^[A-Za-z_$][A-Za-z0-9_$]*$"
      },
      "requestSchema": {
        "type": "string",
        "pattern": "^schemas/operations/[a-z0-9][a-z0-9-]*\\.json$"
      },
      "responseSchema": {
        "type": "string",
        "pattern": "^schemas/operations/[a-z0-9][a-z0-9-]*\\.json$"
      },
      "timeoutClass": {
        "enum": [
          "short",
          "standard",
          "action"
        ]
      },
      "maxRequestBytes": {
        "type": "integer",
        "minimum": 0,
        "maximum": 65536
      },
      "maxResponseBytes": {
        "type": "integer",
        "minimum": 1,
        "maximum": 524288
      },
      "auditAction": {
        "type": "string",
        "minLength": 1,
        "maxLength": 80
      }
    },
    "allOf": [
      {
        "if": {
          "properties": {
            "kind": {
              "const": "mutation"
            }
          },
          "required": [
            "kind"
          ]
        },
        "then": {
          "required": [
            "auditAction"
          ]
        },
        "else": {
          "not": {
            "required": [
              "auditAction"
            ]
          }
        }
      }
    ]
  },
  "release-record.v2.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/package/v2/release-record.v2.schema.json",
    "title": "NAD v2 package release record",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schemaVersion",
      "package",
      "provenance",
      "contract",
      "manifest",
      "changelog",
      "hotUpdate",
      "artifact",
      "signature",
      "conformance"
    ],
    "properties": {
      "schemaVersion": {
        "const": 2
      },
      "package": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "kind",
          "id",
          "slug",
          "name",
          "version",
          "publisher"
        ],
        "properties": {
          "kind": {
            "enum": [
              "app",
              "addon"
            ]
          },
          "id": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9-]*)+$"
          },
          "slug": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9-]{0,63}$"
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "version": {
            "type": "string",
            "pattern": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:[-+][0-9A-Za-z.-]+)?$"
          },
          "publisher": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          }
        }
      },
      "provenance": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "releasedAt",
          "sourceRevision",
          "sourceDirectory",
          "license"
        ],
        "properties": {
          "releasedAt": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
          },
          "sourceRevision": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "sourceDirectory": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "license": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          },
          "repositoryUrl": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 500
          },
          "sourceUrl": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 500
          },
          "sourceTag": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 200
          }
        }
      },
      "contract": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "packageSchema",
          "hostApi",
          "uiApi",
          "sha256"
        ],
        "properties": {
          "packageSchema": {
            "const": 2
          },
          "hostApi": {
            "const": "2.0"
          },
          "uiApi": {
            "const": "2.0"
          },
          "sha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        }
      },
      "manifest": {
        "$ref": "manifest.v2.schema.json"
      },
      "changelog": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "summary",
          "entries"
        ],
        "properties": {
          "summary": {
            "type": "string",
            "minLength": 1,
            "maxLength": 500
          },
          "entries": {
            "type": "array",
            "minItems": 1,
            "maxItems": 12,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 300
            }
          }
        }
      },
      "hotUpdate": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "compatibility",
          "preserves"
        ],
        "properties": {
          "compatibility": {
            "enum": [
              "compatible",
              "restart-required"
            ]
          },
          "preserves": {
            "type": "array",
            "minItems": 1,
            "maxItems": 16,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            }
          }
        }
      },
      "artifact": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "fileName",
          "path",
          "bytes",
          "sha256",
          "entryCount",
          "entries"
        ],
        "properties": {
          "fileName": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9.-]*\\.nadmod$"
          },
          "path": {
            "type": "string",
            "minLength": 1,
            "maxLength": 240
          },
          "bytes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 52428800
          },
          "sha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "entryCount": {
            "type": "integer",
            "minimum": 1,
            "maximum": 200
          },
          "entries": {
            "type": "array",
            "minItems": 1,
            "maxItems": 200,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 240
            }
          }
        }
      },
      "signature": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mode",
          "keyId",
          "verified",
          "warnings"
        ],
        "properties": {
          "mode": {
            "const": "signed"
          },
          "keyId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$"
          },
          "verified": {
            "const": true
          },
          "warnings": {
            "type": "array",
            "maxItems": 20,
            "items": {
              "type": "string",
              "maxLength": 500
            }
          }
        }
      },
      "reviewAttestation": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "url",
          "sha256",
          "reviewerKeyId"
        ],
        "properties": {
          "url": {
            "type": "string",
            "minLength": 1,
            "maxLength": 500
          },
          "sha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "reviewerKeyId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$"
          }
        }
      },
      "conformance": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "checks"
        ],
        "properties": {
          "checks": {
            "type": "array",
            "minItems": 3,
            "maxItems": 24,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "name",
                "passed",
                "detail"
              ],
              "properties": {
                "name": {
                  "enum": [
                    "package-contract",
                    "package-verification",
                    "trusted-signature",
                    "sandbox-ui",
                    "dependency-contract"
                  ]
                },
                "passed": {
                  "type": "boolean"
                },
                "detail": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 500
                }
              }
            }
          }
        }
      }
    }
  },
  "review-attestation.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/marketplace/review-attestation.v1.schema.json",
    "title": "NAD exact-digest review attestation",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schemaVersion",
      "algorithm",
      "reviewerKeyId",
      "signedPayload",
      "signature"
    ],
    "properties": {
      "schemaVersion": {
        "const": 1
      },
      "algorithm": {
        "const": "Ed25519"
      },
      "reviewerKeyId": {
        "type": "string",
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$"
      },
      "signedPayload": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "packageId",
          "slug",
          "version",
          "artifactSha256",
          "sourceRevision",
          "contractSha256",
          "reviewedAt",
          "verdict",
          "surfaces"
        ],
        "properties": {
          "packageId": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9-]*)+$"
          },
          "slug": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9-]{0,63}$"
          },
          "version": {
            "type": "string",
            "pattern": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:[-+][0-9A-Za-z.-]+)?$"
          },
          "artifactSha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "sourceRevision": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "contractSha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "reviewedAt": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$"
          },
          "expiresAt": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$"
          },
          "verdict": {
            "enum": [
              "reviewed",
              "rejected"
            ]
          },
          "surfaces": {
            "type": "array",
            "maxItems": 32,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "id",
                "executionMode",
                "privileges"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "pattern": "^[a-z0-9][a-z0-9-]{0,63}$"
                },
                "executionMode": {
                  "enum": [
                    "sandbox",
                    "trusted"
                  ]
                },
                "privileges": {
                  "type": "array",
                  "maxItems": 4,
                  "uniqueItems": true,
                  "items": {
                    "enum": [
                      "theme",
                      "resize",
                      "navigation",
                      "connection-selection"
                    ]
                  }
                }
              }
            }
          }
        }
      },
      "signature": {
        "type": "string",
        "minLength": 1,
        "maxLength": 512
      }
    }
  },
  "ui-bridge-connect.v2.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/package/v2/ui-bridge-connect.v2.schema.json",
    "title": "NAD UI API v2 surface connection bootstrap",
    "description": "Posted by the NAD host window with exactly one transferred MessagePort. The port itself is transport state and is not represented in this JSON document.",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "type",
      "bridgeVersion",
      "sessionId"
    ],
    "properties": {
      "type": {
        "const": "nad.ui.connect"
      },
      "bridgeVersion": {
        "const": 2
      },
      "sessionId": {
        "type": "string",
        "pattern": "^[A-Za-z0-9_-]{22,128}$"
      }
    }
  },
  "ui-bridge-message.v2.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/package/v2/ui-bridge-message.v2.schema.json",
    "title": "NAD UI API v2 MessageChannel envelope",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "bridgeVersion",
      "sessionId",
      "messageId",
      "type",
      "payload"
    ],
    "properties": {
      "bridgeVersion": {
        "const": 2
      },
      "sessionId": {
        "type": "string",
        "pattern": "^[A-Za-z0-9_-]{22,128}$"
      },
      "messageId": {
        "type": "string",
        "pattern": "^[A-Za-z0-9_-]{8,128}$"
      },
      "replyTo": {
        "type": "string",
        "pattern": "^[A-Za-z0-9_-]{8,128}$"
      },
      "type": {
        "enum": [
          "surface.ready",
          "surface.context",
          "binding.invoke",
          "binding.result",
          "binding.error",
          "resize.request",
          "navigation.request",
          "connection.select.request",
          "diagnostic.emit",
          "theme.changed",
          "connection.changed",
          "access.revoked"
        ]
      },
      "payload": {}
    },
    "allOf": [
      {
        "if": {
          "properties": {
            "type": {
              "const": "surface.ready"
            }
          },
          "required": [
            "type"
          ]
        },
        "then": {
          "properties": {
            "payload": {
              "$ref": "#/$defs/empty"
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "type": {
              "const": "surface.context"
            }
          },
          "required": [
            "type"
          ]
        },
        "then": {
          "required": [
            "replyTo"
          ],
          "properties": {
            "payload": {
              "$ref": "#/$defs/surfaceContext"
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "type": {
              "const": "binding.invoke"
            }
          },
          "required": [
            "type"
          ]
        },
        "then": {
          "properties": {
            "payload": {
              "$ref": "#/$defs/bindingInvoke"
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "type": {
              "const": "binding.result"
            }
          },
          "required": [
            "type"
          ]
        },
        "then": {
          "required": [
            "replyTo"
          ],
          "properties": {
            "payload": {
              "$ref": "#/$defs/bindingResult"
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "type": {
              "const": "binding.error"
            }
          },
          "required": [
            "type"
          ]
        },
        "then": {
          "required": [
            "replyTo"
          ],
          "properties": {
            "payload": {
              "$ref": "#/$defs/bindingError"
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "type": {
              "const": "resize.request"
            }
          },
          "required": [
            "type"
          ]
        },
        "then": {
          "properties": {
            "payload": {
              "$ref": "#/$defs/resizeRequest"
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "type": {
              "const": "navigation.request"
            }
          },
          "required": [
            "type"
          ]
        },
        "then": {
          "properties": {
            "payload": {
              "$ref": "#/$defs/navigationRequest"
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "type": {
              "const": "connection.select.request"
            }
          },
          "required": [
            "type"
          ]
        },
        "then": {
          "properties": {
            "payload": {
              "$ref": "#/$defs/connectionSelectRequest"
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "type": {
              "const": "diagnostic.emit"
            }
          },
          "required": [
            "type"
          ]
        },
        "then": {
          "properties": {
            "payload": {
              "$ref": "#/$defs/diagnostic"
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "type": {
              "const": "theme.changed"
            }
          },
          "required": [
            "type"
          ]
        },
        "then": {
          "properties": {
            "payload": {
              "$ref": "#/$defs/themeChanged"
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "type": {
              "const": "connection.changed"
            }
          },
          "required": [
            "type"
          ]
        },
        "then": {
          "properties": {
            "payload": {
              "$ref": "#/$defs/connectionChanged"
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "type": {
              "const": "access.revoked"
            }
          },
          "required": [
            "type"
          ]
        },
        "then": {
          "properties": {
            "payload": {
              "$ref": "#/$defs/accessRevoked"
            }
          }
        }
      }
    ],
    "$defs": {
      "empty": {
        "type": "object",
        "additionalProperties": false
      },
      "bindingName": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9-]{0,63}$"
      },
      "connectionSummary": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "name"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{16,128}$"
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          }
        }
      },
      "surfaceContext": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "moduleSlug",
          "surfaceId",
          "bindings",
          "connectionSlots",
          "theme"
        ],
        "properties": {
          "moduleSlug": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9-]{0,63}$"
          },
          "surfaceId": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9-]{0,63}$"
          },
          "bindings": {
            "type": "array",
            "maxItems": 32,
            "uniqueItems": true,
            "items": {
              "$ref": "#/$defs/bindingName"
            }
          },
          "connectionSlots": {
            "type": "array",
            "maxItems": 8,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "slot",
                "selectedProfileId",
                "profiles"
              ],
              "properties": {
                "slot": {
                  "$ref": "#/$defs/bindingName"
                },
                "selectedProfileId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "pattern": "^[A-Za-z0-9_-]{16,128}$"
                },
                "profiles": {
                  "type": "array",
                  "maxItems": 128,
                  "items": {
                    "$ref": "#/$defs/connectionSummary"
                  }
                }
              }
            }
          },
          "theme": {
            "enum": [
              "dark",
              "light"
            ]
          }
        }
      },
      "bindingInvoke": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "binding",
          "input"
        ],
        "properties": {
          "binding": {
            "$ref": "#/$defs/bindingName"
          },
          "input": {}
        }
      },
      "bindingResult": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "binding",
          "result"
        ],
        "properties": {
          "binding": {
            "$ref": "#/$defs/bindingName"
          },
          "result": {}
        }
      },
      "bindingError": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "code",
          "message"
        ],
        "properties": {
          "binding": {
            "$ref": "#/$defs/bindingName"
          },
          "code": {
            "type": "string",
            "pattern": "^[A-Z][A-Z0-9_]{0,79}$"
          },
          "message": {
            "type": "string",
            "minLength": 1,
            "maxLength": 500
          }
        }
      },
      "resizeRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "height"
        ],
        "properties": {
          "width": {
            "type": "integer",
            "minimum": 1,
            "maximum": 8192
          },
          "height": {
            "type": "integer",
            "minimum": 160,
            "maximum": 1200
          }
        }
      },
      "navigationRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "path"
        ],
        "properties": {
          "path": {
            "type": "string",
            "pattern": "^/[a-z0-9/-]*$",
            "maxLength": 120
          }
        }
      },
      "connectionSelectRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "slot"
        ],
        "properties": {
          "slot": {
            "$ref": "#/$defs/bindingName"
          }
        }
      },
      "diagnostic": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "level",
          "code",
          "message"
        ],
        "properties": {
          "level": {
            "enum": [
              "debug",
              "info",
              "warning",
              "error"
            ]
          },
          "code": {
            "type": "string",
            "pattern": "^[A-Z][A-Z0-9_]{0,79}$"
          },
          "message": {
            "type": "string",
            "minLength": 1,
            "maxLength": 500
          },
          "metadata": {
            "type": "object",
            "maxProperties": 16,
            "propertyNames": {
              "pattern": "^[A-Za-z0-9_.:-]{1,80}$"
            },
            "additionalProperties": {
              "type": [
                "string",
                "number",
                "boolean",
                "null"
              ]
            }
          }
        }
      },
      "themeChanged": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "theme"
        ],
        "properties": {
          "theme": {
            "enum": [
              "dark",
              "light"
            ]
          }
        }
      },
      "connectionChanged": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "slot",
          "profileId"
        ],
        "properties": {
          "slot": {
            "$ref": "#/$defs/bindingName"
          },
          "profileId": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^[A-Za-z0-9_-]{16,128}$"
          }
        }
      },
      "accessRevoked": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "reason"
        ],
        "properties": {
          "reason": {
            "type": "string",
            "minLength": 1,
            "maxLength": 300
          }
        }
      }
    }
  },
  "ui-surfaces.v2.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/package/v2/ui-surfaces.v2.schema.json",
    "title": "NAD UI API v2 surfaces",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schemaVersion",
      "surfaces"
    ],
    "properties": {
      "schemaVersion": {
        "const": 2
      },
      "surfaces": {
        "type": "array",
        "minItems": 1,
        "maxItems": 32,
        "items": {
          "$ref": "#/$defs/surface"
        }
      }
    },
    "$defs": {
      "gridSize": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "w",
          "h"
        ],
        "properties": {
          "w": {
            "type": "integer",
            "minimum": 1,
            "maximum": 12
          },
          "h": {
            "type": "integer",
            "minimum": 1,
            "maximum": 24
          }
        }
      },
      "connectionSlot": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "slot",
          "target",
          "required"
        ],
        "properties": {
          "slot": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9-]{0,63}$"
          },
          "target": {
            "type": "string",
            "pattern": "^(self|[a-z][a-z0-9-]{0,63})$"
          },
          "required": {
            "type": "boolean"
          }
        }
      },
      "binding": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "target",
          "operation"
        ],
        "properties": {
          "target": {
            "type": "string",
            "pattern": "^(self|[a-z][a-z0-9-]{0,63})$"
          },
          "operation": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9.-]{0,79}$"
          },
          "connectionSlot": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9-]{0,63}$"
          }
        }
      },
      "execution": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "requestedMode",
          "privileges"
        ],
        "properties": {
          "requestedMode": {
            "enum": [
              "sandbox",
              "trusted"
            ]
          },
          "privileges": {
            "type": "array",
            "maxItems": 4,
            "uniqueItems": true,
            "items": {
              "enum": [
                "theme",
                "resize",
                "navigation",
                "connection-selection"
              ]
            }
          }
        }
      },
      "surface": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "kind",
          "name",
          "description",
          "entry",
          "bridge",
          "permissions",
          "bindings",
          "execution"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9-]{0,63}$"
          },
          "kind": {
            "enum": [
              "widget",
              "page"
            ]
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "description": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "icon": {
            "type": "string",
            "maxLength": 64
          },
          "entry": {
            "type": "string",
            "pattern": "^ui/surfaces/[a-z0-9][a-z0-9-]*\\.html$"
          },
          "bridge": {
            "const": "2.x"
          },
          "permissions": {
            "type": "array",
            "minItems": 1,
            "maxItems": 16,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "maxLength": 80
            }
          },
          "connectionSlots": {
            "type": "array",
            "maxItems": 8,
            "items": {
              "$ref": "#/$defs/connectionSlot"
            }
          },
          "bindings": {
            "type": "object",
            "maxProperties": 32,
            "propertyNames": {
              "pattern": "^[a-z][a-z0-9-]{0,63}$"
            },
            "additionalProperties": {
              "$ref": "#/$defs/binding"
            }
          },
          "widget": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "defaultSize",
              "chrome"
            ],
            "properties": {
              "defaultSize": {
                "$ref": "#/$defs/gridSize"
              },
              "minSize": {
                "$ref": "#/$defs/gridSize"
              },
              "maxSize": {
                "$ref": "#/$defs/gridSize"
              },
              "chrome": {
                "enum": [
                  "standard",
                  "solid",
                  "frameless"
                ]
              }
            }
          },
          "page": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "path"
            ],
            "properties": {
              "path": {
                "type": "string",
                "pattern": "^/[a-z0-9/-]*$",
                "maxLength": 120
              },
              "pinEligible": {
                "type": "boolean"
              }
            }
          },
          "execution": {
            "$ref": "#/$defs/execution"
          }
        },
        "allOf": [
          {
            "if": {
              "properties": {
                "kind": {
                  "const": "widget"
                }
              },
              "required": [
                "kind"
              ]
            },
            "then": {
              "required": [
                "widget"
              ],
              "not": {
                "required": [
                  "page"
                ]
              }
            },
            "else": {
              "required": [
                "page"
              ],
              "not": {
                "required": [
                  "widget"
                ]
              }
            }
          }
        ]
      }
    }
  }
} as const;
