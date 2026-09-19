/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/causa_vault.json`.
 */
export type CausaVault = {
  "address": "99n7VGd6132b4UUwhSezLm9xXssdnJFiSPrEKkCuMHPF",
  "metadata": {
    "name": "causaVault",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "acceptAdmin",
      "discriminator": [
        112,
        42,
        45,
        90,
        116,
        181,
        13,
        170
      ],
      "accounts": [
        {
          "name": "pendingAdmin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "allowBasketMint",
      "discriminator": [
        179,
        106,
        97,
        161,
        247,
        253,
        56,
        174
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "basket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  115,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "bindLaunch",
      "discriminator": [
        232,
        218,
        212,
        235,
        181,
        237,
        215,
        108
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.salt",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "bondingCurve"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "cancelEpoch",
      "discriminator": [
        120,
        226,
        234,
        25,
        215,
        85,
        0,
        155
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.salt",
                "account": "vault"
              }
            ]
          },
          "relations": [
            "epoch"
          ]
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "epoch.id",
                "account": "epoch"
              }
            ]
          }
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "claim",
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.salt",
                "account": "vault"
              }
            ]
          },
          "relations": [
            "epoch"
          ]
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "arg",
                "path": "params.epochId"
              }
            ]
          }
        },
        {
          "name": "account"
        },
        {
          "name": "claimStatus",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  108,
                  97,
                  105,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "epoch"
              },
              {
                "kind": "account",
                "path": "account"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "claimParams"
            }
          }
        }
      ]
    },
    {
      "name": "createVault",
      "discriminator": [
        29,
        237,
        247,
        208,
        193,
        82,
        54,
        135
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "params.salt"
              }
            ]
          }
        },
        {
          "name": "quoteMint",
          "address": "So11111111111111111111111111111111111111112"
        },
        {
          "name": "vaultQuoteAta",
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "createVaultParams"
            }
          }
        }
      ]
    },
    {
      "name": "expireEpoch",
      "discriminator": [
        62,
        0,
        93,
        101,
        17,
        210,
        169,
        64
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.salt",
                "account": "vault"
              }
            ]
          },
          "relations": [
            "epoch"
          ]
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "epoch.id",
                "account": "epoch"
              }
            ]
          }
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "harvestIntake",
      "discriminator": [
        55,
        123,
        51,
        162,
        94,
        26,
        210,
        27
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.salt",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "vaultQuoteAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "protocolQuoteAta",
          "writable": true
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "maxInput",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initConfig",
      "discriminator": [
        23,
        235,
        115,
        232,
        168,
        96,
        1,
        231
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "initConfigParams"
            }
          }
        }
      ]
    },
    {
      "name": "publishEpoch",
      "discriminator": [
        222,
        6,
        136,
        82,
        54,
        246,
        245,
        120
      ],
      "accounts": [
        {
          "name": "operator",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.salt",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "epoch",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "publishEpochParams"
            }
          }
        }
      ]
    },
    {
      "name": "rescue",
      "discriminator": [
        42,
        111,
        16,
        88,
        147,
        101,
        209,
        62
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.salt",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "creatorAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "revokeBasketMint",
      "discriminator": [
        59,
        239,
        108,
        217,
        7,
        109,
        96,
        225
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "basket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  115,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "basket.mint",
                "account": "allowedBasketMint"
              }
            ]
          }
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "setAutoClaim",
      "discriminator": [
        135,
        111,
        55,
        239,
        20,
        249,
        33,
        144
      ],
      "accounts": [
        {
          "name": "creator",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.salt",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "enabled",
          "type": "bool"
        }
      ]
    },
    {
      "name": "swapBegin",
      "discriminator": [
        87,
        236,
        193,
        120,
        215,
        245,
        9,
        37
      ],
      "accounts": [
        {
          "name": "operator",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.salt",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "vaultQuoteAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "operatorQuoteAta",
          "writable": true
        },
        {
          "name": "legMint"
        },
        {
          "name": "vaultLegAta",
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "legTokenProgram"
              },
              {
                "kind": "account",
                "path": "legMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "legTokenProgram"
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "instructionsSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "leg",
          "type": "u8"
        }
      ]
    },
    {
      "name": "swapSettle",
      "discriminator": [
        201,
        181,
        97,
        21,
        167,
        157,
        235,
        126
      ],
      "accounts": [
        {
          "name": "operator",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.salt",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "legMint"
        },
        {
          "name": "vaultLegAta",
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "legTokenProgram"
              },
              {
                "kind": "account",
                "path": "legMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "legTokenProgram"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "leg",
          "type": "u8"
        },
        {
          "name": "minOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "transferAdmin",
      "discriminator": [
        42,
        242,
        66,
        106,
        228,
        10,
        111,
        156
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "updateConfig",
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "updateConfigParams"
            }
          }
        }
      ]
    },
    {
      "name": "wrapFees",
      "discriminator": [
        51,
        143,
        228,
        150,
        69,
        84,
        185,
        16
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.salt",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "vaultQuoteAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "program"
        }
      ],
      "args": [],
      "returns": "u64"
    }
  ],
  "accounts": [
    {
      "name": "allowedBasketMint",
      "discriminator": [
        6,
        197,
        9,
        150,
        234,
        235,
        217,
        218
      ]
    },
    {
      "name": "claimStatus",
      "discriminator": [
        22,
        183,
        249,
        157,
        247,
        95,
        150,
        96
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "epoch",
      "discriminator": [
        93,
        83,
        120,
        89,
        151,
        138,
        152,
        108
      ]
    },
    {
      "name": "vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  "events": [
    {
      "name": "autoClaimUpdated",
      "discriminator": [
        177,
        243,
        206,
        188,
        16,
        108,
        228,
        15
      ]
    },
    {
      "name": "basketMintUpdated",
      "discriminator": [
        24,
        139,
        152,
        132,
        187,
        34,
        152,
        42
      ]
    },
    {
      "name": "claimed",
      "discriminator": [
        217,
        192,
        123,
        72,
        108,
        150,
        248,
        33
      ]
    },
    {
      "name": "configUpdated",
      "discriminator": [
        40,
        241,
        230,
        122,
        11,
        19,
        198,
        194
      ]
    },
    {
      "name": "epochCancelled",
      "discriminator": [
        207,
        234,
        62,
        125,
        97,
        159,
        190,
        48
      ]
    },
    {
      "name": "epochExpired",
      "discriminator": [
        100,
        30,
        119,
        234,
        71,
        13,
        47,
        170
      ]
    },
    {
      "name": "epochPublished",
      "discriminator": [
        221,
        95,
        77,
        98,
        203,
        18,
        192,
        225
      ]
    },
    {
      "name": "harvested",
      "discriminator": [
        249,
        229,
        78,
        151,
        106,
        185,
        149,
        11
      ]
    },
    {
      "name": "launchBound",
      "discriminator": [
        160,
        163,
        145,
        8,
        136,
        40,
        41,
        97
      ]
    },
    {
      "name": "rescued",
      "discriminator": [
        121,
        161,
        19,
        44,
        228,
        240,
        254,
        193
      ]
    },
    {
      "name": "swapSettled",
      "discriminator": [
        104,
        192,
        63,
        194,
        238,
        236,
        149,
        85
      ]
    },
    {
      "name": "vaultCreated",
      "discriminator": [
        117,
        25,
        120,
        254,
        75,
        236,
        78,
        115
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Unauthorized"
    },
    {
      "code": 6001,
      "name": "paused",
      "msg": "Program is paused"
    },
    {
      "code": 6002,
      "name": "protocolShareTooHigh",
      "msg": "Protocol share above the 20% cap"
    },
    {
      "code": 6003,
      "name": "disputeWindowTooLong",
      "msg": "Dispute window must be shorter than the minimum epoch length"
    },
    {
      "code": 6004,
      "name": "basketLength",
      "msg": "Basket must have 1 to 10 legs"
    },
    {
      "code": 6005,
      "name": "mintNotAllowed",
      "msg": "Basket mint is not on the allowlist"
    },
    {
      "code": 6006,
      "name": "duplicateMint",
      "msg": "Duplicate basket mint"
    },
    {
      "code": 6007,
      "name": "weightsMustSum",
      "msg": "Basket weights must be non-zero and sum to 10000"
    },
    {
      "code": 6008,
      "name": "epochLengthTooShort",
      "msg": "Epoch length below the minimum"
    },
    {
      "code": 6009,
      "name": "alreadyBound",
      "msg": "Vault is already bound to a launch"
    },
    {
      "code": 6010,
      "name": "notBound",
      "msg": "Vault is not bound to a launch yet"
    },
    {
      "code": 6011,
      "name": "notPumpAccount",
      "msg": "Bonding curve account is not owned by the pump program"
    },
    {
      "code": 6012,
      "name": "wrongBondingCurve",
      "msg": "Bonding curve does not belong to the expected mint"
    },
    {
      "code": 6013,
      "name": "wrongCreator",
      "msg": "Launch creator is not this vault"
    },
    {
      "code": 6014,
      "name": "nothingToHarvest",
      "msg": "Nothing to harvest"
    },
    {
      "code": 6015,
      "name": "swapInFlight",
      "msg": "A swap is already in flight"
    },
    {
      "code": 6016,
      "name": "noSwapInFlight",
      "msg": "No swap in flight"
    },
    {
      "code": 6017,
      "name": "settleNotInTransaction",
      "msg": "swap_begin must be followed by swap_settle in the same transaction"
    },
    {
      "code": 6018,
      "name": "badLeg",
      "msg": "Leg index out of range"
    },
    {
      "code": 6019,
      "name": "nothingToSwap",
      "msg": "Leg has nothing pending to swap"
    },
    {
      "code": 6020,
      "name": "insufficientOutput",
      "msg": "Swap output below minimum"
    },
    {
      "code": 6021,
      "name": "wrongLegAccount",
      "msg": "Basket account does not match the leg"
    },
    {
      "code": 6022,
      "name": "periodMismatch",
      "msg": "Epoch period must start where the previous one ended"
    },
    {
      "code": 6023,
      "name": "invalidPeriod",
      "msg": "Invalid epoch period"
    },
    {
      "code": 6024,
      "name": "lengthMismatch",
      "msg": "Length mismatch"
    },
    {
      "code": 6025,
      "name": "insufficientUnallocated",
      "msg": "Not enough unallocated tokens for this epoch"
    },
    {
      "code": 6026,
      "name": "epochNotOpen",
      "msg": "Epoch is not open"
    },
    {
      "code": 6027,
      "name": "epochNotCancellable",
      "msg": "Only the latest epoch can be cancelled, and only before it becomes claimable"
    },
    {
      "code": 6028,
      "name": "epochNotExpirable",
      "msg": "Epoch claim window has not closed yet"
    },
    {
      "code": 6029,
      "name": "epochNotClaimable",
      "msg": "Epoch is not claimable yet"
    },
    {
      "code": 6030,
      "name": "invalidProof",
      "msg": "Invalid Merkle proof"
    },
    {
      "code": 6031,
      "name": "epochOverclaim",
      "msg": "Claim exceeds the epoch's declared amount for this token"
    },
    {
      "code": 6032,
      "name": "nothingPending",
      "msg": "Nothing pending for this account and mint"
    },
    {
      "code": 6033,
      "name": "tokenNotRescuable",
      "msg": "Basket and quote balances can never be rescued"
    },
    {
      "code": 6034,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "allowedBasketMint",
      "docs": [
        "Marker: this mint may be a basket leg. PDA [\"basket\", mint]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "type": "pubkey"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "autoClaimUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "enabled",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "basketMintUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "allowed",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "claimParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epochId",
            "type": "u64"
          },
          {
            "name": "amounts",
            "docs": [
              "Per epoch leg, in basket order."
            ],
            "type": {
              "vec": "u64"
            }
          },
          {
            "name": "proof",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "claimStatus",
      "docs": [
        "Existence = claimed. PDA [\"claim\", epoch, account]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "type": "pubkey"
          },
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "claimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "epochId",
            "type": "u64"
          },
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "amounts",
            "type": {
              "vec": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "Protocol-wide configuration (the old DividendVaultFactory storage). One per program."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "pendingAdmin",
            "docs": [
              "Two-step admin transfer; `Pubkey::default()` when none is pending."
            ],
            "type": "pubkey"
          },
          {
            "name": "operator",
            "docs": [
              "The keeper. Harvests, settles swaps, publishes roots, delivers claims."
            ],
            "type": "pubkey"
          },
          {
            "name": "protocolShareBps",
            "type": "u16"
          },
          {
            "name": "protocolRecipient",
            "type": "pubkey"
          },
          {
            "name": "disputeWindow",
            "docs": [
              "Seconds after `publish_epoch` during which the creator or admin may cancel it."
            ],
            "type": "u32"
          },
          {
            "name": "claimWindow",
            "docs": [
              "Seconds after `claimable_at` before anyone may expire the epoch."
            ],
            "type": "u32"
          },
          {
            "name": "minEpochLength",
            "type": "u32"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "vaultCount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "protocolShareBps",
            "type": "u16"
          },
          {
            "name": "protocolRecipient",
            "type": "pubkey"
          },
          {
            "name": "disputeWindow",
            "type": "u32"
          },
          {
            "name": "claimWindow",
            "type": "u32"
          },
          {
            "name": "minEpochLength",
            "type": "u32"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "createVaultParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "salt",
            "type": "u64"
          },
          {
            "name": "weightsBps",
            "type": {
              "vec": "u16"
            }
          },
          {
            "name": "epochLength",
            "type": "u32"
          },
          {
            "name": "expectedMint",
            "docs": [
              "The pump mint the creator will launch with this vault as `creator`."
            ],
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "epoch",
      "docs": [
        "One payout epoch. PDA [\"epoch\", vault, id]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "root",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "periodStart",
            "type": "i64"
          },
          {
            "name": "periodEnd",
            "type": "i64"
          },
          {
            "name": "claimableAt",
            "type": "i64"
          },
          {
            "name": "holderCount",
            "type": "u32"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "epochStatus"
              }
            }
          },
          {
            "name": "legs",
            "type": {
              "vec": {
                "defined": {
                  "name": "epochLeg"
                }
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "epochCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "epochId",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "epochExpired",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "epochId",
            "type": "u64"
          },
          {
            "name": "returned",
            "type": {
              "vec": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "epochLeg",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "claimedTotal",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "epochPublished",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "pubkey"
          },
          {
            "name": "epochId",
            "type": "u64"
          },
          {
            "name": "root",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "periodStart",
            "type": "i64"
          },
          {
            "name": "periodEnd",
            "type": "i64"
          },
          {
            "name": "claimableAt",
            "type": "i64"
          },
          {
            "name": "mints",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "amounts",
            "type": {
              "vec": "u64"
            }
          },
          {
            "name": "holderCount",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "epochStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "cancelled"
          },
          {
            "name": "expired"
          }
        ]
      }
    },
    {
      "name": "harvested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "input",
            "type": "u64"
          },
          {
            "name": "protocolCut",
            "type": "u64"
          },
          {
            "name": "legInputs",
            "docs": [
              "Per leg: quote reserved for swapping (or credited directly when the leg is the quote mint)."
            ],
            "type": {
              "vec": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "initConfigParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "protocolShareBps",
            "type": "u16"
          },
          {
            "name": "protocolRecipient",
            "type": "pubkey"
          },
          {
            "name": "disputeWindow",
            "type": "u32"
          },
          {
            "name": "claimWindow",
            "type": "u32"
          },
          {
            "name": "minEpochLength",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "launchBound",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "bondingCurve",
            "type": "pubkey"
          },
          {
            "name": "boundAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "leg",
      "docs": [
        "One basket leg with its accounting. Invariant per leg (raw units, checked in tests):",
        "`vault_ata(mint).amount >= unallocated + allocated` (+ every leg's `pending_swap` for the quote mint)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "type": "pubkey"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "weightBps",
            "type": "u16"
          },
          {
            "name": "unallocated",
            "docs": [
              "Harvested, not yet assigned to an epoch."
            ],
            "type": "u64"
          },
          {
            "name": "allocated",
            "docs": [
              "Assigned to open epochs, not yet claimed."
            ],
            "type": "u64"
          },
          {
            "name": "pendingSwap",
            "docs": [
              "Quote reserved for this leg by `harvest_intake`, consumed by `swap_begin`/`swap_settle`."
            ],
            "type": "u64"
          },
          {
            "name": "harvestedTotal",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "publishEpochParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "root",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "amounts",
            "docs": [
              "Per basket leg, in basket order (zero for a leg that pays nothing this epoch)."
            ],
            "type": {
              "vec": "u64"
            }
          },
          {
            "name": "periodStart",
            "type": "i64"
          },
          {
            "name": "periodEnd",
            "type": "i64"
          },
          {
            "name": "holderCount",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "rescued",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "swapSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "leg",
            "type": "u8"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amountIn",
            "type": "u64"
          },
          {
            "name": "amountOut",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "updateConfigParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "operator",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "protocolShareBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "protocolRecipient",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "disputeWindow",
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "claimWindow",
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "minEpochLength",
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "paused",
            "type": {
              "option": "bool"
            }
          }
        ]
      }
    },
    {
      "name": "vault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "salt",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "expectedMint",
            "docs": [
              "The mint the creator committed to at `create_vault`; `bind_launch` only accepts this one."
            ],
            "type": "pubkey"
          },
          {
            "name": "launchMint",
            "docs": [
              "`Pubkey::default()` until bound."
            ],
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "docs": [
              "Creator fees arrive in this mint (wrapped SOL for SOL-quoted coins)."
            ],
            "type": "pubkey"
          },
          {
            "name": "quoteTokenProgram",
            "type": "pubkey"
          },
          {
            "name": "epochLength",
            "type": "u32"
          },
          {
            "name": "boundAt",
            "type": "i64"
          },
          {
            "name": "lastPeriodEnd",
            "type": "i64"
          },
          {
            "name": "epochCount",
            "type": "u64"
          },
          {
            "name": "autoClaim",
            "docs": [
              "Creator opt-in for keeper-paid delivery."
            ],
            "type": "bool"
          },
          {
            "name": "legs",
            "type": {
              "vec": {
                "defined": {
                  "name": "leg"
                }
              }
            }
          },
          {
            "name": "inputTotal",
            "type": "u64"
          },
          {
            "name": "protocolCutTotal",
            "type": "u64"
          },
          {
            "name": "harvestCount",
            "type": "u64"
          },
          {
            "name": "swapInFlight",
            "docs": [
              "Transient swap session; only ever set inside one transaction (see swap_begin/swap_settle)."
            ],
            "type": "bool"
          },
          {
            "name": "swapLeg",
            "type": "u8"
          },
          {
            "name": "swapPreBalance",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vaultCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "salt",
            "type": "u64"
          },
          {
            "name": "expectedMint",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "mints",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "weightsBps",
            "type": {
              "vec": "u16"
            }
          },
          {
            "name": "epochLength",
            "type": "u32"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "basketSeed",
      "type": "bytes",
      "value": "[98, 97, 115, 107, 101, 116]"
    },
    {
      "name": "bps",
      "type": "u16",
      "value": "10000"
    },
    {
      "name": "claimSeed",
      "type": "bytes",
      "value": "[99, 108, 97, 105, 109]"
    },
    {
      "name": "configSeed",
      "type": "bytes",
      "value": "[99, 111, 110, 102, 105, 103]"
    },
    {
      "name": "epochSeed",
      "type": "bytes",
      "value": "[101, 112, 111, 99, 104]"
    },
    {
      "name": "maxBasket",
      "type": "u8",
      "value": "10"
    },
    {
      "name": "maxProtocolShareBps",
      "type": "u16",
      "value": "2000"
    },
    {
      "name": "vaultSeed",
      "type": "bytes",
      "value": "[118, 97, 117, 108, 116]"
    }
  ]
};
