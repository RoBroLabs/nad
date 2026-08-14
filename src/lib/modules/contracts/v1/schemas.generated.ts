/** Generated from the canonical NAD v1 JSON Schemas. Do not edit. */
export const CONTRACT_SHA256 = '9f4bdc674bcb0c23debdb3fe2b0dd78d7d95123259bec0b9ac66708e67ee81d2' as const;
export const contractLock = {
  "schemaVersion": 1,
  "contractVersion": "1.0",
  "packageSchemaVersion": 1,
  "hostApiVersion": "1.0",
  "hostApiCompatibility": "1.x",
  "uiApiVersion": "1.0",
  "uiApiCompatibility": "1.x",
  "capabilities": [
    "config.get",
    "http.request",
    "notifications.emit",
    "storage.get",
    "storage.set",
    "storage.delete",
    "audit.annotate"
  ],
  "sha256": "9f4bdc674bcb0c23debdb3fe2b0dd78d7d95123259bec0b9ac66708e67ee81d2",
  "files": {
    "checksums.schema.json": "a1176c29ffa3171b92ba25a3ead56263d869b84daf2deec386854c932be27f46",
    "data-migration.v1.schema.json": "fbfb3f82e21872b5e03ff765a8549f22293c60c301e10a905d087b0b4f94828d",
    "endpoint-schema.v1.schema.json": "440462fb5e6ac527bf0bec6d6fc43b432b93f2be45f4af18638ea67911607963",
    "host-call.schema.json": "a8a8208e0d788a4a16114dae98e206325f4d369eda1729b5a744c6a435a28820",
    "host-http-response.schema.json": "2461ccefd8d499b52b0791d0f1a82ee1499b94bc51c509323e0574abc35a9203",
    "http-access.v1.schema.json": "b1e000bf93ddab875a118f32363bb2d583b19556947564e2e181ddca2350bf07",
    "manifest.schema.json": "7e264643567481697057321c3520cdce5b8821c556382f9edc341dd543015010",
    "module-request.schema.json": "a2701f8d75feae86c5cf64f28e7d2a4591db1a25b075907a5f066b2a1de4036f",
    "release-metadata.schema.json": "906255b68bb33856ea1f5d0a3407882501980c46c03b7aa1990545ab095ed03a",
    "release-record.schema.json": "13fb613ea7f21125f2a3f7fd47b34c536a152b45072be1c571a7611d9cc00f3b",
    "secret-reference.schema.json": "9f419fce63bf2e39f15ed4b56dac36ee4cecd46e89e535b3384fca3ef07a6cb1",
    "signature-envelope.schema.json": "e83f03d90019dd1159bcdcf29f24636e76df769921acb1d2bb7e1eee76d1343f",
    "signature.schema.json": "ced8a7859860de6e9dcd15dec840c46e51aa9a10e97ad8fba6ba492fbddc285b",
    "ui-element.v1.schema.json": "e3996309ee20a944efdcaffe59dc8b848496886a1c4d99fc3856c86a91e3e9c8",
    "ui-pages.schema.json": "13d38db5abc4593a4047580357b5127d23e737210c2a4bd134a9582838b7e63f",
    "ui-widgets.schema.json": "4562d60bf85acdd4aa0422041b84f29d9f34cf45c8713dc41c88e6725f16bc20"
  }
} as const;
export const contractSchemas = {
  "checksums.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/module/checksums.v1.schema.json",
    "title": "ModuleChecksumsDocument",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schemaVersion",
      "algorithm",
      "files"
    ],
    "properties": {
      "schemaVersion": {
        "const": 1
      },
      "algorithm": {
        "const": "sha256"
      },
      "files": {
        "type": "object",
        "additionalProperties": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      }
    }
  },
  "data-migration.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/module/data-migration.v1.schema.json",
    "title": "ModuleDataMigrationDocument",
    "type": "object",
    "additionalProperties": false,
    "minProperties": 3,
    "required": [
      "fromVersion",
      "toVersion"
    ],
    "properties": {
      "fromVersion": {
        "$ref": "#/$defs/semver"
      },
      "toVersion": {
        "$ref": "#/$defs/semver"
      },
      "config": {
        "type": "array",
        "minItems": 1,
        "maxItems": 64,
        "items": {
          "$ref": "#/$defs/operation"
        }
      },
      "storage": {
        "type": "array",
        "minItems": 1,
        "maxItems": 64,
        "items": {
          "$ref": "#/$defs/operation"
        }
      }
    },
    "$defs": {
      "semver": {
        "type": "string",
        "pattern": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:[-+][0-9A-Za-z.-]+)?$"
      },
      "key": {
        "type": "string",
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
      },
      "operation": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "op",
              "from",
              "to"
            ],
            "properties": {
              "op": {
                "const": "rename"
              },
              "from": {
                "$ref": "#/$defs/key"
              },
              "to": {
                "$ref": "#/$defs/key"
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "op",
              "key",
              "value"
            ],
            "properties": {
              "op": {
                "const": "setDefault"
              },
              "key": {
                "$ref": "#/$defs/key"
              },
              "value": {}
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "op",
              "key"
            ],
            "properties": {
              "op": {
                "const": "delete"
              },
              "key": {
                "$ref": "#/$defs/key"
              }
            }
          }
        ]
      }
    }
  },
  "endpoint-schema.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/module/endpoint-schema.v1.schema.json",
    "title": "ModuleEndpointSchemaDocument",
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "$schema": {
        "const": "https://json-schema.org/draft/2020-12/schema"
      },
      "title": {
        "type": "string",
        "maxLength": 200
      },
      "type": {
        "oneOf": [
          {
            "$ref": "#/$defs/jsonType"
          },
          {
            "type": "array",
            "minItems": 1,
            "maxItems": 7,
            "uniqueItems": true,
            "items": {
              "$ref": "#/$defs/jsonType"
            }
          }
        ]
      },
      "const": {},
      "enum": {
        "type": "array",
        "minItems": 1,
        "maxItems": 100,
        "uniqueItems": true
      },
      "minimum": {
        "type": "number"
      },
      "maximum": {
        "type": "number"
      },
      "minLength": {
        "type": "integer",
        "minimum": 0,
        "maximum": 1000000
      },
      "maxLength": {
        "type": "integer",
        "minimum": 0,
        "maximum": 1000000
      },
      "pattern": {
        "type": "string",
        "maxLength": 500
      },
      "minItems": {
        "type": "integer",
        "minimum": 0,
        "maximum": 100000
      },
      "maxItems": {
        "type": "integer",
        "minimum": 0,
        "maximum": 100000
      },
      "uniqueItems": {
        "type": "boolean"
      },
      "minProperties": {
        "type": "integer",
        "minimum": 0,
        "maximum": 100000
      },
      "maxProperties": {
        "type": "integer",
        "minimum": 0,
        "maximum": 100000
      },
      "required": {
        "type": "array",
        "maxItems": 1000,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        }
      },
      "properties": {
        "type": "object",
        "maxProperties": 1000,
        "additionalProperties": {
          "$ref": "#"
        }
      },
      "additionalProperties": {
        "type": "boolean"
      },
      "items": {
        "$ref": "#"
      }
    },
    "$defs": {
      "jsonType": {
        "enum": [
          "null",
          "boolean",
          "object",
          "array",
          "number",
          "integer",
          "string"
        ]
      }
    }
  },
  "host-call.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/module/host-call.v1.schema.json",
    "title": "ModuleHostCallDocument",
    "oneOf": [
      {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "method",
          "params"
        ],
        "properties": {
          "method": {
            "const": "config.get"
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
                "minLength": 1,
                "maxLength": 64
              }
            }
          }
        }
      },
      {
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
            "$ref": "#/$defs/httpRequest"
          }
        }
      },
      {
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
            "$ref": "#/$defs/notification"
          }
        }
      },
      {
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
      {
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
      {
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
      {
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
            "$ref": "#/$defs/auditMetadata"
          }
        }
      }
    ],
    "$defs": {
      "httpRequest": {
        "title": "ModuleHostHttpRequest",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "url"
        ],
        "properties": {
          "url": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2048
          },
          "method": {
            "enum": [
              "GET",
              "POST",
              "PUT",
              "DELETE"
            ]
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
      },
      "notification": {
        "title": "ModuleHostNotification",
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
      "auditMetadata": {
        "title": "ModuleAuditMetadata",
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
  "host-http-response.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/module/host-http-response.v1.schema.json",
    "title": "ModuleHostHttpResponse",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "status",
      "headers",
      "body"
    ],
    "properties": {
      "status": {
        "type": "integer",
        "minimum": 100,
        "maximum": 599
      },
      "headers": {
        "type": "object",
        "additionalProperties": {
          "type": "string"
        }
      },
      "body": {}
    }
  },
  "http-access.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/module/http-access.v1.schema.json",
    "title": "ModuleHttpAccessScopeDocument",
    "oneOf": [
      {
        "$ref": "#/$defs/fixedPortHttpAccessScope"
      },
      {
        "$ref": "#/$defs/configuredPortHttpAccessScope"
      },
      {
        "$ref": "#/$defs/urlPortHttpAccessScope"
      }
    ],
    "$defs": {
      "httpMethods": {
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
      "headerNames": {
        "type": "array",
        "maxItems": 8,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "pattern": "^[A-Za-z0-9-]+$"
        }
      },
      "queryParameters": {
        "type": "array",
        "maxItems": 16,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "pattern": "^[A-Za-z0-9_.~-]+$"
        }
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
      "credentialInjection": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "config",
          "location",
          "name"
        ],
        "properties": {
          "config": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9_-]{0,63}$"
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
          "publicConfig": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9_-]{0,63}$"
          },
          "separator": {
            "type": "string",
            "maxLength": 16
          }
        }
      },
      "sharedProperties": {
        "scheme": {
          "enum": [
            "http",
            "https"
          ]
        },
        "hostConfig": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9_-]{0,63}$"
        },
        "path": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2048,
          "pattern": "^/[^?#]*$"
        },
        "methods": {
          "$ref": "#/$defs/httpMethods"
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
          "$ref": "#/$defs/headerNames"
        },
        "queryParameters": {
          "$ref": "#/$defs/queryParameters"
        },
        "pathParameters": {
          "$ref": "#/$defs/pathParameters"
        },
        "credential": {
          "$ref": "#/$defs/credentialInjection"
        },
        "tlsVerifyConfig": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9_-]{0,63}$"
        }
      },
      "fixedPortHttpAccessScope": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "scheme",
          "hostConfig",
          "port",
          "path",
          "methods"
        ],
        "properties": {
          "scheme": {
            "$ref": "#/$defs/sharedProperties/scheme"
          },
          "hostConfig": {
            "$ref": "#/$defs/sharedProperties/hostConfig"
          },
          "port": {
            "type": "integer",
            "minimum": 1,
            "maximum": 65535
          },
          "path": {
            "$ref": "#/$defs/sharedProperties/path"
          },
          "methods": {
            "$ref": "#/$defs/sharedProperties/methods"
          },
          "effect": {
            "$ref": "#/$defs/sharedProperties/effect"
          },
          "requestBodyPolicy": {
            "$ref": "#/$defs/sharedProperties/requestBodyPolicy"
          },
          "allowedHeaders": {
            "$ref": "#/$defs/sharedProperties/allowedHeaders"
          },
          "queryParameters": {
            "$ref": "#/$defs/sharedProperties/queryParameters"
          },
          "pathParameters": {
            "$ref": "#/$defs/sharedProperties/pathParameters"
          },
          "credential": {
            "$ref": "#/$defs/sharedProperties/credential"
          },
          "tlsVerifyConfig": {
            "$ref": "#/$defs/sharedProperties/tlsVerifyConfig"
          }
        }
      },
      "configuredPortHttpAccessScope": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "scheme",
          "hostConfig",
          "portConfig",
          "path",
          "methods"
        ],
        "properties": {
          "scheme": {
            "$ref": "#/$defs/sharedProperties/scheme"
          },
          "hostConfig": {
            "$ref": "#/$defs/sharedProperties/hostConfig"
          },
          "portConfig": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9_-]{0,63}$"
          },
          "path": {
            "$ref": "#/$defs/sharedProperties/path"
          },
          "methods": {
            "$ref": "#/$defs/sharedProperties/methods"
          },
          "effect": {
            "$ref": "#/$defs/sharedProperties/effect"
          },
          "requestBodyPolicy": {
            "$ref": "#/$defs/sharedProperties/requestBodyPolicy"
          },
          "allowedHeaders": {
            "$ref": "#/$defs/sharedProperties/allowedHeaders"
          },
          "queryParameters": {
            "$ref": "#/$defs/sharedProperties/queryParameters"
          },
          "pathParameters": {
            "$ref": "#/$defs/sharedProperties/pathParameters"
          },
          "credential": {
            "$ref": "#/$defs/sharedProperties/credential"
          },
          "tlsVerifyConfig": {
            "$ref": "#/$defs/sharedProperties/tlsVerifyConfig"
          }
        }
      },
      "urlPortHttpAccessScope": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "scheme",
          "hostConfig",
          "path",
          "methods"
        ],
        "properties": {
          "scheme": {
            "$ref": "#/$defs/sharedProperties/scheme"
          },
          "hostConfig": {
            "$ref": "#/$defs/sharedProperties/hostConfig"
          },
          "path": {
            "$ref": "#/$defs/sharedProperties/path"
          },
          "methods": {
            "$ref": "#/$defs/sharedProperties/methods"
          },
          "effect": {
            "$ref": "#/$defs/sharedProperties/effect"
          },
          "requestBodyPolicy": {
            "$ref": "#/$defs/sharedProperties/requestBodyPolicy"
          },
          "allowedHeaders": {
            "$ref": "#/$defs/sharedProperties/allowedHeaders"
          },
          "queryParameters": {
            "$ref": "#/$defs/sharedProperties/queryParameters"
          },
          "pathParameters": {
            "$ref": "#/$defs/sharedProperties/pathParameters"
          },
          "credential": {
            "$ref": "#/$defs/sharedProperties/credential"
          },
          "tlsVerifyConfig": {
            "$ref": "#/$defs/sharedProperties/tlsVerifyConfig"
          }
        }
      }
    }
  },
  "manifest.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/module/manifest.v1.schema.json",
    "title": "ModuleManifestDocument",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schemaVersion",
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
      "configSchema",
      "entrypoints"
    ],
    "allOf": [
      {
        "if": {
          "properties": {
            "capabilities": {
              "type": "array",
              "contains": {
                "type": "object",
                "required": [
                  "name"
                ],
                "properties": {
                  "name": {
                    "const": "http.request"
                  }
                }
              }
            }
          }
        },
        "then": {
          "required": [
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
    ],
    "properties": {
      "schemaVersion": {
        "const": 1
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
            "type": "string"
          },
          "hostApi": {
            "type": "string"
          },
          "uiApi": {
            "type": "string"
          }
        }
      },
      "capabilities": {
        "type": "array",
        "minItems": 1,
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
                "config.get",
                "http.request",
                "notifications.emit",
                "storage.get",
                "storage.set",
                "storage.delete",
                "audit.annotate"
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
      "httpAccess": {
        "type": "array",
        "minItems": 1,
        "maxItems": 32,
        "uniqueItems": true,
        "items": {
          "$ref": "http-access.v1.schema.json"
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
      "configSchema": {
        "type": "array",
        "maxItems": 64,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "key",
            "label",
            "type",
            "required"
          ],
          "properties": {
            "key": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            },
            "label": {
              "type": "string",
              "minLength": 1,
              "maxLength": 80
            },
            "type": {
              "enum": [
                "text",
                "url",
                "secret",
                "number",
                "boolean",
                "select"
              ]
            },
            "required": {
              "type": "boolean"
            },
            "description": {
              "type": "string",
              "maxLength": 300
            },
            "placeholder": {
              "type": "string",
              "maxLength": 200
            },
            "defaultValue": {
              "type": [
                "string",
                "number",
                "boolean"
              ]
            },
            "min": {
              "type": "number"
            },
            "max": {
              "type": "number"
            },
            "options": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "label",
                  "value"
                ],
                "properties": {
                  "label": {
                    "type": "string"
                  },
                  "value": {
                    "type": "string"
                  }
                }
              }
            }
          }
        }
      },
      "dataMigrations": {
        "type": "array",
        "maxItems": 32,
        "items": {
          "$ref": "data-migration.v1.schema.json"
        }
      },
      "entrypoints": {
        "type": "object",
        "minProperties": 1,
        "maxProperties": 64,
        "additionalProperties": {
          "oneOf": [
            {
              "$ref": "#/$defs/queryEntrypoint"
            },
            {
              "$ref": "#/$defs/mutationEntrypoint"
            }
          ]
        }
      }
    },
    "$defs": {
      "queryEntrypoint": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "method",
          "kind",
          "permission",
          "handler",
          "requestSchema",
          "responseSchema",
          "timeoutClass",
          "maxRequestBytes",
          "maxResponseBytes"
        ],
        "properties": {
          "method": {
            "enum": [
              "GET",
              "POST",
              "PUT",
              "DELETE"
            ]
          },
          "kind": {
            "const": "query"
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
            "pattern": "^schemas/endpoints/[a-z0-9][a-z0-9-]*\\.json$"
          },
          "responseSchema": {
            "type": "string",
            "pattern": "^schemas/endpoints/[a-z0-9][a-z0-9-]*\\.json$"
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
          }
        }
      },
      "mutationEntrypoint": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "method",
          "kind",
          "permission",
          "handler",
          "requestSchema",
          "responseSchema",
          "timeoutClass",
          "maxRequestBytes",
          "maxResponseBytes",
          "auditAction"
        ],
        "properties": {
          "method": {
            "enum": [
              "POST",
              "PUT",
              "DELETE"
            ]
          },
          "kind": {
            "const": "mutation"
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
            "pattern": "^schemas/endpoints/[a-z0-9][a-z0-9-]*\\.json$"
          },
          "responseSchema": {
            "type": "string",
            "pattern": "^schemas/endpoints/[a-z0-9][a-z0-9-]*\\.json$"
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
        }
      }
    }
  },
  "module-request.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/module/request.v1.schema.json",
    "title": "ModuleInvocationRequestDocument",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "method"
    ],
    "properties": {
      "method": {
        "enum": [
          "GET",
          "POST",
          "PUT",
          "DELETE"
        ]
      },
      "body": {}
    }
  },
  "release-metadata.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/module/release-metadata.v1.schema.json",
    "title": "ModuleReleaseMetadataDocument",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schemaVersion",
      "releasedAt",
      "sourceDirectory",
      "license",
      "changelog",
      "hotUpdate"
    ],
    "properties": {
      "schemaVersion": {
        "const": 1
      },
      "releasedAt": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "sourceRevision": {
        "type": [
          "string",
          "null"
        ],
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
        "minLength": 1,
        "maxLength": 200
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
            "const": "compatible"
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
      }
    }
  },
  "release-record.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/module/release-record.v1.schema.json",
    "title": "ModuleReleaseRecordDocument",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schemaVersion",
      "module",
      "provenance",
      "manifest",
      "changelog",
      "hotUpdate",
      "artifact",
      "signature",
      "conformance"
    ],
    "properties": {
      "schemaVersion": {
        "const": 1
      },
      "module": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "slug",
          "name",
          "version",
          "publisher"
        ],
        "properties": {
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
      "manifest": {
        "$ref": "#/$defs/manifestSummary"
      },
      "changelog": {
        "$ref": "#/$defs/changelog"
      },
      "hotUpdate": {
        "$ref": "#/$defs/hotUpdate"
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
          "verified",
          "warnings"
        ],
        "properties": {
          "mode": {
            "enum": [
              "signed",
              "unsigned-dev"
            ]
          },
          "keyId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$"
          },
          "verified": {
            "type": "boolean"
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
            "maxItems": 20,
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
                    "module-contract",
                    "package-verification",
                    "trusted-signature"
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
    },
    "$defs": {
      "capability": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name",
          "reason"
        ],
        "properties": {
          "name": {
            "enum": [
              "config.get",
              "http.request",
              "notifications.emit",
              "storage.get",
              "storage.set",
              "storage.delete",
              "audit.annotate"
            ]
          },
          "reason": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          }
        }
      },
      "httpAccessScope": {
        "$ref": "http-access.v1.schema.json"
      },
      "permission": {
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
      },
      "manifestSummary": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "schemaVersion",
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
          "permissions"
        ],
        "properties": {
          "schemaVersion": {
            "const": 1
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
                "type": "string"
              },
              "hostApi": {
                "type": "string"
              },
              "uiApi": {
                "type": "string"
              }
            }
          },
          "capabilities": {
            "type": "array",
            "minItems": 1,
            "items": {
              "$ref": "#/$defs/capability"
            }
          },
          "httpAccess": {
            "type": "array",
            "minItems": 1,
            "maxItems": 32,
            "uniqueItems": true,
            "items": {
              "$ref": "#/$defs/httpAccessScope"
            }
          },
          "permissions": {
            "type": "array",
            "minItems": 1,
            "maxItems": 32,
            "items": {
              "$ref": "#/$defs/permission"
            }
          },
          "dataMigrations": {
            "type": "array",
            "maxItems": 32,
            "items": {
              "$ref": "data-migration.v1.schema.json"
            }
          }
        }
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
            "const": "compatible"
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
      }
    }
  },
  "secret-reference.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/module/secret-reference.v1.schema.json",
    "title": "ModuleSecretReference",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "secretRef",
      "present"
    ],
    "properties": {
      "secretRef": {
        "type": "string",
        "maxLength": 240
      },
      "present": {
        "type": "boolean"
      }
    }
  },
  "signature-envelope.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://nad.robrolabs.com/schemas/v1/signature-envelope.schema.json",
    "title": "NAD Module signature envelope",
    "description": "The exact UTF-8 JSON object signed for a schema-v1 Module package. Implementations sort files by path before JSON serialization.",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "moduleId",
      "version",
      "digestAlgorithm",
      "files"
    ],
    "properties": {
      "moduleId": {
        "type": "string",
        "minLength": 3,
        "maxLength": 160
      },
      "version": {
        "type": "string",
        "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$"
      },
      "digestAlgorithm": {
        "const": "sha256"
      },
      "files": {
        "type": "object",
        "minProperties": 1,
        "additionalProperties": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      }
    },
    "examples": [
      {
        "moduleId": "dev.robrolabs.fixture",
        "version": "1.2.3",
        "digestAlgorithm": "sha256",
        "files": {
          "a.txt": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "z.txt": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        }
      }
    ]
  },
  "signature.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/module/signature.v1.schema.json",
    "title": "ModuleSignatureDocument",
    "oneOf": [
      {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "schemaVersion",
          "mode",
          "warning",
          "signedPayload"
        ],
        "properties": {
          "schemaVersion": {
            "const": 1
          },
          "mode": {
            "const": "unsigned-dev"
          },
          "warning": {
            "type": "string",
            "minLength": 1,
            "maxLength": 500
          },
          "signedPayload": {
            "$ref": "#/$defs/signedPayload"
          }
        }
      },
      {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "schemaVersion",
          "mode",
          "algorithm",
          "keyId",
          "signature",
          "signedPayload"
        ],
        "properties": {
          "schemaVersion": {
            "const": 1
          },
          "mode": {
            "const": "signed"
          },
          "algorithm": {
            "const": "Ed25519"
          },
          "keyId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$"
          },
          "signature": {
            "type": "string",
            "minLength": 1,
            "maxLength": 512
          },
          "signedPayload": {
            "$ref": "#/$defs/signedPayload"
          }
        }
      }
    ],
    "$defs": {
      "signedPayload": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "moduleId",
          "version",
          "digestAlgorithm",
          "files"
        ],
        "properties": {
          "moduleId": {
            "type": "string"
          },
          "version": {
            "type": "string"
          },
          "digestAlgorithm": {
            "const": "sha256"
          },
          "files": {
            "type": "object",
            "additionalProperties": {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            }
          }
        }
      }
    }
  },
  "ui-element.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/module/ui-element.v1.schema.json",
    "title": "ModuleUiElementDocument",
    "oneOf": [
      {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "type",
          "body"
        ],
        "properties": {
          "type": {
            "const": "section"
          },
          "title": {
            "type": "string",
            "maxLength": 100
          },
          "body": {
            "type": "array",
            "minItems": 1,
            "maxItems": 64,
            "items": {
              "$ref": "#"
            }
          }
        }
      },
      {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "type",
          "label",
          "valuePath"
        ],
        "properties": {
          "type": {
            "enum": [
              "metric",
              "status"
            ]
          },
          "label": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "valuePath": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          },
          "unit": {
            "type": "string",
            "maxLength": 30
          },
          "tonePath": {
            "type": "string",
            "maxLength": 160
          }
        }
      },
      {
        "type": "object",
        "additionalProperties": false,
        "minProperties": 2,
        "required": [
          "type"
        ],
        "properties": {
          "type": {
            "const": "text"
          },
          "value": {
            "type": "string",
            "maxLength": 500
          },
          "valuePath": {
            "type": "string",
            "maxLength": 160
          }
        }
      },
      {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "type",
          "items"
        ],
        "properties": {
          "type": {
            "const": "keyValue"
          },
          "items": {
            "type": "array",
            "minItems": 1,
            "maxItems": 32,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "label",
                "valuePath"
              ],
              "properties": {
                "label": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 100
                },
                "valuePath": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160
                },
                "unit": {
                  "type": "string",
                  "maxLength": 30
                }
              }
            }
          }
        }
      },
      {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "type",
          "rowsPath",
          "columns"
        ],
        "properties": {
          "type": {
            "const": "table"
          },
          "rowsPath": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          },
          "columns": {
            "type": "array",
            "minItems": 1,
            "maxItems": 16,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "key",
                "label",
                "valuePath"
              ],
              "properties": {
                "key": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80
                },
                "label": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 100
                },
                "valuePath": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160
                }
              }
            }
          },
          "emptyText": {
            "type": "string",
            "maxLength": 200
          }
        }
      }
    ]
  },
  "ui-pages.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/module/ui-pages.v1.schema.json",
    "title": "ModulePagesDocument",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schemaVersion",
      "pages"
    ],
    "properties": {
      "schemaVersion": {
        "const": 1
      },
      "pages": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "path",
            "title",
            "body"
          ],
          "properties": {
            "path": {
              "const": "/"
            },
            "title": {
              "type": "string",
              "minLength": 1,
              "maxLength": 80
            },
            "icon": {
              "type": "string",
              "maxLength": 64
            },
            "source": {
              "$ref": "#/$defs/source"
            },
            "body": {
              "type": "array",
              "minItems": 1,
              "items": {
                "$ref": "#/$defs/element"
              }
            }
          }
        }
      }
    },
    "$defs": {
      "source": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "endpoint"
        ],
        "properties": {
          "endpoint": {
            "type": "string"
          },
          "refreshIntervalMs": {
            "type": "integer",
            "minimum": 1000
          }
        }
      },
      "element": {
        "$ref": "ui-element.v1.schema.json"
      }
    }
  },
  "ui-widgets.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/module/ui-widgets.v1.schema.json",
    "title": "ModuleWidgetsDocument",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schemaVersion",
      "widgets"
    ],
    "properties": {
      "schemaVersion": {
        "const": 1
      },
      "widgets": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "id",
            "name",
            "description",
            "defaultSize",
            "source",
            "body"
          ],
          "properties": {
            "id": {
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
              "maxLength": 200
            },
            "defaultSize": {
              "$ref": "#/$defs/gridSize"
            },
            "minSize": {
              "$ref": "#/$defs/gridSize"
            },
            "maxSize": {
              "$ref": "#/$defs/gridSize"
            },
            "source": {
              "$ref": "#/$defs/source"
            },
            "requiredConfig": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "body": {
              "type": "array",
              "minItems": 1,
              "items": {
                "$ref": "#/$defs/element"
              }
            }
          }
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
      "source": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "endpoint"
        ],
        "properties": {
          "endpoint": {
            "type": "string"
          },
          "refreshIntervalMs": {
            "type": "integer",
            "minimum": 1000
          }
        }
      },
      "element": {
        "$ref": "ui-element.v1.schema.json"
      }
    }
  }
} as const;
