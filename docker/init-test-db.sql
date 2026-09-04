-- The integration tests truncate every table they touch, so they get their own
-- database rather than sharing the development one.
CREATE DATABASE picklelounge_test;
