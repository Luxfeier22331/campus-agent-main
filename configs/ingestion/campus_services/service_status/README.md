# service_status collection config

`service_status` is an offline structured projection consumed through
`service_status_lookup`.

This profile does not open retrieval or a default query-serving alias. It only
declares that the projection-backed structured query runtime may consume the
current read model.
