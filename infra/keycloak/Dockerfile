FROM quay.io/keycloak/keycloak:26.7.0 AS builder
ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true \
    KC_METRICS_ENABLED=true
COPY infra/keycloak/themes/ /opt/keycloak/themes/
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.7.0
COPY --from=builder /opt/keycloak/ /opt/keycloak/
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
