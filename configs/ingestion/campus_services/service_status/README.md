# service_status collection config

`service_status` is a structured projection consumed through
`service_status_lookup`.

This profile uses `structured_query_serving`: it does not open generic
retrieval or a default query-serving alias. It only declares that the
projection-backed structured query runtime may consume the current read model.
