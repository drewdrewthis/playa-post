Feature: Invitations — opaque revocable tokens
  As an onboarded user
  I want to create and share an invite token
  So that another user can accept it and become a connection

  # M2 scope: create invite (opaque revocable token), open invite.
  # Cut to M5: revocation UI, expiry policy.

  @unit
  # @ac:M2-AC17
  Scenario: Invite token generator uses a CSPRNG source
    Given the invite token generator module
    When a token is generated
    Then the generator calls a CSPRNG with at least 16 bytes of entropy
    And a fitness rule fails any non-CSPRNG source in that module

  @unit
  # @ac:M2-AC17
  Scenario: Ten thousand generated tokens are all distinct
    Given the invite token generator
    When 10000 tokens are generated
    Then all 10000 tokens are distinct
    And every token passes the length and charset assertion

  @unit
  # @ac:M2-AC17
  Scenario: Generated token does not encode the inviter's identity
    Given a user with a known internal ID and handle
    When an invite token is generated for that user
    Then the token is not a prefix, suffix, or encoding of the user's ID
    And the token is not a prefix, suffix, or encoding of the user's handle

  @integration
  # @ac:M2-AC17
  Scenario: Invite is created as an opaque revocable token
    Given an onboarded user
    When they create an invite
    Then a token is persisted that carries no decodable relationship to the inviter

  @integration
  # @ac:M2-AC17
  Scenario: Spent invite token cannot be opened again
    Given an invite token that has already been accepted
    When a user attempts to open that token
    Then the response is a structured error with code INVITATION_UNAVAILABLE

  @integration
  # @ac:M2-AC17
  Scenario: Revoked invite token cannot be opened
    Given an invite token that has been revoked
    When a user attempts to open that token
    Then the response is a structured error with code INVITATION_UNAVAILABLE
