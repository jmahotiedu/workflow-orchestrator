SHELL := /bin/sh

.PHONY: setup setup-hooks dev-up dev-down migrate-up build test test-integration lint typecheck bench

setup:
	npm run setup

setup-hooks:
	npm run setup:hooks

dev-up:
	docker compose up -d

dev-down:
	docker compose down -v

migrate-up:
	npm run -w control-plane migrate

build:
	npm run build

test:
	npm run test

test-integration:
	npm run test-integration

lint:
	npm run lint

typecheck:
	npm run typecheck

bench:
	npm run bench
