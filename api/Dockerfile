FROM mcr.microsoft.com/dotnet/sdk:9.0-alpine AS publish
WORKDIR /src
# cache-bust: 20260626201229
COPY *.csproj ./
COPY NuGet.Config ./
RUN dotnet restore --runtime linux-musl-x64
COPY . .
RUN dotnet publish -c Release \
    --runtime linux-musl-x64 \
    --self-contained false \
    --no-restore \
    -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:9.0-alpine AS runtime
WORKDIR /app
RUN addgroup -S tenantwarden && adduser -S -G tenantwarden tenantwarden
USER tenantwarden
COPY --chown=tenantwarden:tenantwarden --from=publish /app/publish ./
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["dotnet", "TenantWarden.Api.dll"]
