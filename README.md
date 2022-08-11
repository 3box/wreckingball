# Wrecking Ball

> Create synthetic load using AWS Lambda.


![Betty White on a Wrecking Ball](./doc/betty.png)


## New deployment

1. Make sure you have valid AWS credentials.
2. `pnpm install`
3. `pnpm run deploy`

That would tell you an endpoint to `produce` function. Remember this endpoint.

## Running

To start the load process, create an HTTP request to the endpoint you got above.
- `count` tells how many simultaneous requests are issued to the Ceramic node,
- `endpoint` is a Ceramic node to run a client against.

```shell
curl --request POST \
  --url <<endpoint>> \
  --header 'Content-Type: application/json' \
  --data '{
        "count": 100,
        "endpoint": "https://ceramic-foo.3boxlabs.com/"
}'
```

## Scenario

`src/handlers/consumer.ts` contains a scenario to run against the Ceramic node.
