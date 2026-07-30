Feature: Identity — magic-link sign-in and actor resolution
  As a Playa Post user
  I want to sign in with a magic link and complete onboarding
  So that the system can resolve me to a stable, private internal actor

  # M2 scope: Supabase magic-link sign-in, app.users per ADR-0008, onboarding (handle +
  # display name) with the full handle rule set, actor resolution and the branded ViewerId
  # at the tRPC context boundary. Cut to M5: avatars, contact fields, deactivation, erasure,
  # suspension, reconciliation cron, export.

  @integration
  # @ac:M2-AC2
  Scenario: Request with no bearer token is unauthorized
    Given no bearer token is presented
    When any authorized procedure is called
    Then the response is HTTP 401

  @integration
  # @ac:M2-AC2
  Scenario: Request with a tampered token is unauthorized
    Given a bearer token whose signature has been altered
    When any authorized procedure is called
    Then the response is HTTP 401

  @integration
  # @ac:M2-AC2
  Scenario: Valid token with incomplete onboarding is blocked from the slice
    Given a valid token for an actor who has not completed onboarding
    When any onboarding-gated procedure is called
    Then the response is HTTP 403 with code ONBOARDING_REQUIRED

  @unit
  # @ac:M2-AC25
  Scenario: Reserved handle is rejected at onboarding
    Given the handle "admin" is on the reserved-word blocklist
    When onboarding submits handle "admin"
    Then the response is a structured error naming the handle rule

  @unit
  # @ac:M2-AC25
  Scenario: Out-of-charset handle is rejected
    Given a handle containing characters outside [a-z0-9_]
    When onboarding submits that handle
    Then the response is a structured error naming the charset rule

  @unit
  # @ac:M2-AC25
  Scenario: Over-length handle is rejected
    Given a handle longer than 24 characters
    When onboarding submits that handle
    Then the response is a structured error naming the length rule

  @integration
  # @ac:M2-AC25
  Scenario: Handle differing only by case from an existing handle is rejected
    Given an existing user with handle "duststorm"
    When onboarding submits handle "DustStorm"
    Then the response is a structured error naming the citext-uniqueness rule

  @integration
  # @ac:M2-AC25
  Scenario: Confusable of an existing handle is rejected
    Given an existing user with a handle
    When onboarding submits a confusable normalization of that handle
    Then the response is a structured error naming the confusable rule

  @integration
  # @ac:M2-AC25
  Scenario: Changing an already-chosen handle is rejected
    Given a user who has already completed onboarding with a handle
    When that user submits a request to change their handle
    Then the response is a structured error with code HANDLE_IMMUTABLE
