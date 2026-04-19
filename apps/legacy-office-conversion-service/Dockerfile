FROM maven:3.9.11-eclipse-temurin-21 AS unit-tests
WORKDIR /build

COPY apps/legacy-office-conversion-service/pom.xml ./pom.xml
RUN mvn -B -q -DskipTests dependency:go-offline

COPY apps/legacy-office-conversion-service/src ./src
RUN mvn -B -q test

FROM unit-tests AS package
RUN mvn -B -q -DskipTests package

FROM eclipse-temurin:21-jre-jammy AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice curl \
    && rm -rf /var/lib/apt/lists/*

ENV LIBREOFFICE_SERVICE_BIND=0.0.0.0:8091 \
    LIBREOFFICE_SERVICE_TASK_TIMEOUT_MS=120000 \
    LIBREOFFICE_SERVICE_QUEUE_TIMEOUT_MS=150000 \
    LIBREOFFICE_SERVICE_MAX_TASKS_PER_PROCESS=200 \
    LIBREOFFICE_SERVICE_WORKDIR=/tmp/legacy-office-conversion

WORKDIR /app
COPY --from=package /build/target/legacy-office-conversion-service-0.1.0.jar /app/app.jar

EXPOSE 8091

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
