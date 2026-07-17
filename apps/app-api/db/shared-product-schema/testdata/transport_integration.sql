INSERT INTO "campus_services"."transport_releases" (
    "release_id",
    "published_at",
    "effective_from",
    "effective_until",
    "source_urls_json",
    "status_json",
    "content_sha256",
    "created_at"
) VALUES (
    'transport:integration:2026-03-20',
    '2026-03-20T18:00:00+08:00',
    '2026-03-21',
    NULL,
    '["https://example.edu/transport/integration"]'::jsonb,
    '{
      "release": {
        "releaseId": "transport:integration:2026-03-20",
        "publishedAt": "2026-03-20T18:00:00+08:00",
        "sourceRefs": ["https://example.edu/transport/integration"]
      },
      "groups": [
        {
          "kind": "daily",
          "routes": [
            {
              "routeId": "route:haidian-to-fengtai",
              "displayName": "Haidian to Fengtai",
              "departures": [
                {
                  "departureTime": "07:30",
                  "kind": "student",
                  "sourceRefs": ["https://example.edu/transport/integration"],
                  "status": "normal"
                }
              ]
            }
          ]
        },
        {
          "kind": "temporary",
          "routes": [
            {
              "routeId": "route:haidian-to-fengtai",
              "displayName": "Haidian to Fengtai",
              "departures": [
                {
                  "departureTime": "08:15",
                  "kind": "student",
                  "serviceDate": "2026-03-21",
                  "sourceRefs": ["https://example.edu/transport/integration"],
                  "status": "added"
                }
              ]
            }
          ]
        }
      ]
    }'::jsonb,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '2026-03-20T18:00:00+08:00'
);

INSERT INTO "campus_services"."transport_routes" (
    "release_id",
    "route_id",
    "display_name",
    "origin_campus",
    "destination_campus",
    "origin_stop_id",
    "origin_stop_name",
    "destination_stop_id",
    "destination_stop_name",
    "aliases_json",
    "sort_order"
) VALUES (
    'transport:integration:2026-03-20',
    'route:haidian-to-fengtai',
    'Haidian to Fengtai',
    'haidian',
    'fengtai',
    'stop:haidian-east-gate',
    'Haidian East Gate',
    'stop:fengtai-main-gate',
    'Fengtai Main Gate',
    '["Fengtai line"]'::jsonb,
    1
);

INSERT INTO "campus_services"."transport_departures" (
    "release_id",
    "departure_id",
    "route_id",
    "service_mode",
    "service_date",
    "effective_from",
    "effective_until",
    "departure_time",
    "departure_kind",
    "status",
    "note",
    "source_urls_json",
    "sort_order"
) VALUES
(
    'transport:integration:2026-03-20',
    'departure:daily:0730',
    'route:haidian-to-fengtai',
    'daily',
    NULL,
    '2026-03-21',
    NULL,
    '07:30',
    'student',
    'normal',
    NULL,
    '["https://example.edu/transport/integration"]'::jsonb,
    1
),
(
    'transport:integration:2026-03-20',
    'departure:temporary:2026-03-21:0815',
    'route:haidian-to-fengtai',
    'temporary',
    '2026-03-21',
    '2026-03-21',
    '2026-03-21',
    '08:15',
    'student',
    'added',
    'Integration service',
    '["https://example.edu/transport/integration"]'::jsonb,
    2
);

INSERT INTO "campus_services"."transport_current" (
    "pointer_key",
    "release_id",
    "updated_at"
) VALUES (
    'current',
    'transport:integration:2026-03-20',
    '2026-03-20T18:00:00+08:00'
);
