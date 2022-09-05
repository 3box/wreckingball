# Wrecking Ball

> Create synthetic load using AWS Lambda.


![Betty White on a Wrecking Ball](./doc/betty.png)


## New deployment

1. Make sure you have valid AWS credentials.
2. `pnpm install`
3. `pnpm run deploy`

That would tell you an endpoint to `produce` as well as `multistream` function. Remember this endpoint.

## Running

There are two scenarios:
1. Single stream scenario aka `produce`: (create a stream, and update it) in number of lambdas.
2. "Multistream": every lambda invocation updates a commit.

### Produce:

To start the load process, create an HTTP request to the `produce` endpoint you got above.
- `count` tells how many simultaneous requests are issued to the Ceramic node,
- `endpoint` is a Ceramic node to run a client against.

```shell
curl --request POST \
  --url <<produce-endpoint>> \
  --header 'Content-Type: application/json' \
  --data '{
        "count": 100,
        "endpoint": "https://ceramic-foo.3boxlabs.com/"
}'
```

This would invoke 100 lambdas, each creates a stream and updates it.

### Multistream:

To start the load process, create an HTTP request to the `multistream` endpoint you got above.
- `count` tells how many simultaneous requests are issued to the Ceramic node,
- `endpoint` is a Ceramic node to run a client against.

```shell
curl --request POST \
  --url <<multistream-endpoint>> \
  --header 'Content-Type: application/json' \
  --data '{
    "count": 200,
    "endpoint": "https://ceramic-foo.3boxlabs.com/",
    "hops": 30
}'
```

This would invoke multiple lambdas to create and update 200 (`count`) streams.
Every invocation adds an update to a stream until it has 30 (`hops`) commits.

## Scenario

`src/handlers/consumer.ts` contains a `produce` scenario to run against the Ceramic node.
`src/handlers/multistream.ts` contains a `multistream` scenario to run against the Ceramic node.
