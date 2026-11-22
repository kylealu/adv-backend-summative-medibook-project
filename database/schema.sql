-- =====================================================================
-- MediBook — Clinic Appointment System
-- DDL script: creates the database and its 3 tables (3NF).
-- Runs cleanly on a fresh MySQL 8.0.16+ server (CHECK constraints are
-- enforced from 8.0.16 onwards).
-- =====================================================================

CREATE DATABASE IF NOT EXISTS medibook
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE medibook;

-- Drop in reverse dependency order so the script can be re-run.
DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS doctors;
DROP TABLE IF EXISTS patients;

-- ---------------------------------------------------------------------
-- patients: one row per person. name/email/phone depend only on the
-- patient, so they live here (removes the repetition of "Ama Mensah"
-- in the original spreadsheet).
-- ---------------------------------------------------------------------
CREATE TABLE patients (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  full_name     VARCHAR(100)  NOT NULL,
  email         VARCHAR(255)  NOT NULL,
  phone         VARCHAR(20)   NOT NULL,
  date_of_birth DATE          NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT pk_patients        PRIMARY KEY (id),
  CONSTRAINT uq_patients_email  UNIQUE (email),
  CONSTRAINT chk_patients_name  CHECK (CHAR_LENGTH(TRIM(full_name)) > 0),
  CONSTRAINT chk_patients_email CHECK (email LIKE '%_@_%._%')
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- doctors: specialty, fee and room depend only on the doctor
-- (in the spreadsheet they were transitively dependent on appt_ref
-- through doctor_name — a 3NF violation).
-- ---------------------------------------------------------------------
CREATE TABLE doctors (
  id               INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  full_name        VARCHAR(100)   NOT NULL,
  email            VARCHAR(255)   NOT NULL,
  specialty        VARCHAR(100)   NOT NULL,
  consultation_fee DECIMAL(10,2)  NOT NULL,
  room             VARCHAR(10)    NOT NULL,
  created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT pk_doctors        PRIMARY KEY (id),
  CONSTRAINT uq_doctors_email  UNIQUE (email),
  CONSTRAINT chk_doctors_name  CHECK (CHAR_LENGTH(TRIM(full_name)) > 0),
  CONSTRAINT chk_doctors_fee   CHECK (consultation_fee >= 0)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- appointments: links one patient to one doctor at one date/time.
--   patients 1 ── N appointments
--   doctors  1 ── N appointments
--
-- amount_paid is stored here (not looked up from doctors) because it is
-- a fact about the transaction: the spreadsheet shows AP-002 paid 120.00
-- against a 150.00 fee, and a doctor's fee can change later without
-- rewriting payment history.
--
-- Cancellation + refund record live on the same row (3-table limit):
-- status, cancelled_at, refund_percent, refund_amount. Cancelled rows are
-- never deleted, so refund history is kept.
--
-- "A doctor cannot have two appointments at the same date/time":
--   active_slot is a STORED generated column = 1 while BOOKED, NULL once
--   CANCELLED. The UNIQUE index on (doctor_id, appt_date, appt_time,
--   active_slot) therefore allows only ONE booked row per doctor slot,
--   while any number of cancelled rows (active_slot = NULL, and NULLs are
--   never equal in a unique index) can share it. This is what lets a
--   cancelled slot be rebooked by another patient, and it is enforced by
--   the database itself — even for two requests arriving at the same
--   instant.
-- ---------------------------------------------------------------------
CREATE TABLE appointments (
  id             INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  patient_id     INT UNSIGNED      NOT NULL,
  doctor_id      INT UNSIGNED      NOT NULL,
  appt_date      DATE              NOT NULL,
  appt_time      TIME              NOT NULL,
  status         ENUM('BOOKED','CANCELLED') NOT NULL DEFAULT 'BOOKED',
  amount_paid    DECIMAL(10,2)     NOT NULL,
  booked_at      DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at   DATETIME          NULL,
  refund_percent TINYINT UNSIGNED  NULL,
  refund_amount  DECIMAL(10,2)     NULL,
  active_slot    TINYINT           AS (IF(status = 'BOOKED', 1, NULL)) STORED,

  CONSTRAINT pk_appointments PRIMARY KEY (id),

  CONSTRAINT fk_appointments_patient
    FOREIGN KEY (patient_id) REFERENCES patients (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_appointments_doctor
    FOREIGN KEY (doctor_id) REFERENCES doctors (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,

  -- One BOOKED appointment per doctor per slot (see note above).
  CONSTRAINT uq_doctor_active_slot
    UNIQUE (doctor_id, appt_date, appt_time, active_slot),

  -- Working hours 09:00–17:00 in 30-minute slots: last slot starts 16:30.
  CONSTRAINT chk_appt_working_hours
    CHECK (appt_time BETWEEN '09:00:00' AND '16:30:00'),
  CONSTRAINT chk_appt_slot_boundary
    CHECK (MINUTE(appt_time) IN (0, 30) AND SECOND(appt_time) = 0),

  CONSTRAINT chk_appt_amount_paid
    CHECK (amount_paid >= 0),
  CONSTRAINT chk_appt_refund_percent
    CHECK (refund_percent IS NULL OR refund_percent IN (0, 50, 100)),
  CONSTRAINT chk_appt_refund_amount
    CHECK (refund_amount IS NULL OR (refund_amount >= 0 AND refund_amount <= amount_paid)),

  -- A booked row has no cancellation data; a cancelled row must have all of it.
  CONSTRAINT chk_appt_status_consistency
    CHECK (
      (status = 'BOOKED'    AND cancelled_at IS NULL     AND refund_percent IS NULL     AND refund_amount IS NULL)
   OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND refund_percent IS NOT NULL AND refund_amount IS NOT NULL)
    ),

  -- Supports per-patient lookups and the "patient already busy at this time" check.
  INDEX idx_appointments_patient_slot (patient_id, appt_date, appt_time),
  -- Supports daily-cap counting and the reports.
  INDEX idx_appointments_doctor_day_status (doctor_id, appt_date, status)
) ENGINE = InnoDB;
