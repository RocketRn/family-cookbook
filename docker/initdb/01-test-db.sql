-- Separate database for the test suite (tests refuse to run against a DB whose name lacks "test").
CREATE DATABASE cookbook_test OWNER cookbook;
