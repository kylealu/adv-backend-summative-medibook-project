-- =====================================================================
-- MediBook — sample data
-- Run after schema.sql. Appointment dates are relative to CURDATE() so
-- the "upcoming", "next 7 days" and "busy days" features always have
-- something to show, whenever the seed is loaded.
-- =====================================================================

USE medibook;

INSERT INTO patients (full_name, email, phone, date_of_birth) VALUES
  ('Ama Mensah',     'ama@mail.com',    '0244-111-222', '1990-04-12'),
  ('Kojo Owusu',     'kojo@mail.com',   '0555-333-444', '1985-11-03'),
  ('Efua Asante',    'efua@mail.com',   '0201-555-666', '2001-02-27'),
  ('Yaw Darko',      'yaw@mail.com',    '0277-777-888', '1978-07-19'),
  ('Akosua Nkrumah', 'akosua@mail.com', '0266-999-000', '2015-09-08');

INSERT INTO doctors (full_name, email, specialty, consultation_fee, room) VALUES
  ('Dr. Boateng',      'boateng@medibook.clinic', 'Dermatology', 150.00, 'R-12'),
  ('Dr. Adjei',        'adjei@medibook.clinic',   'Paediatrics', 100.00, 'R-03'),
  ('Dr. Larbi',        'larbi@medibook.clinic',   'Cardiology',  250.00, 'R-07'),
  -- Dr. Ofori deliberately has NO appointments (shows up with zeros in the doctors report).
  ('Dr. Ofori',        'ofori@medibook.clinic',   'General Practice', 80.00, 'R-01');

-- ---------------------------------------------------------------------
-- Dr. Boateng (id 1), CURDATE() + 3 days: 11 booked slots out of 12
-- (92% — above the 80% "busy day" threshold, one slot left before the cap)
-- plus one cancelled appointment kept for refund history.
-- ---------------------------------------------------------------------
INSERT INTO appointments (patient_id, doctor_id, appt_date, appt_time, amount_paid, booked_at) VALUES
  (1, 1, DATE_ADD(CURDATE(), INTERVAL 3 DAY), '09:00:00', 150.00, DATE_SUB(NOW(), INTERVAL 10 DAY)),
  (2, 1, DATE_ADD(CURDATE(), INTERVAL 3 DAY), '09:30:00', 120.00, DATE_SUB(NOW(), INTERVAL 9 DAY)),
  (3, 1, DATE_ADD(CURDATE(), INTERVAL 3 DAY), '10:00:00', 150.00, DATE_SUB(NOW(), INTERVAL 9 DAY)),
  (4, 1, DATE_ADD(CURDATE(), INTERVAL 3 DAY), '10:30:00', 150.00, DATE_SUB(NOW(), INTERVAL 8 DAY)),
  (5, 1, DATE_ADD(CURDATE(), INTERVAL 3 DAY), '11:00:00', 150.00, DATE_SUB(NOW(), INTERVAL 8 DAY)),
  (1, 1, DATE_ADD(CURDATE(), INTERVAL 3 DAY), '11:30:00', 150.00, DATE_SUB(NOW(), INTERVAL 7 DAY)),
  (2, 1, DATE_ADD(CURDATE(), INTERVAL 3 DAY), '12:00:00', 150.00, DATE_SUB(NOW(), INTERVAL 7 DAY)),
  (3, 1, DATE_ADD(CURDATE(), INTERVAL 3 DAY), '12:30:00', 150.00, DATE_SUB(NOW(), INTERVAL 6 DAY)),
  (4, 1, DATE_ADD(CURDATE(), INTERVAL 3 DAY), '13:00:00', 150.00, DATE_SUB(NOW(), INTERVAL 6 DAY)),
  (5, 1, DATE_ADD(CURDATE(), INTERVAL 3 DAY), '13:30:00', 150.00, DATE_SUB(NOW(), INTERVAL 5 DAY)),
  (1, 1, DATE_ADD(CURDATE(), INTERVAL 3 DAY), '14:00:00', 150.00, DATE_SUB(NOW(), INTERVAL 5 DAY));

-- Cancelled more than 48h ahead -> 100% refund. Slot 14:30 is free again.
INSERT INTO appointments
  (patient_id, doctor_id, appt_date, appt_time, status, amount_paid, booked_at, cancelled_at, refund_percent, refund_amount)
VALUES
  (2, 1, DATE_ADD(CURDATE(), INTERVAL 3 DAY), '14:30:00', 'CANCELLED', 150.00,
   DATE_SUB(NOW(), INTERVAL 4 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY), 100, 150.00);

-- ---------------------------------------------------------------------
-- Dr. Adjei (id 2): one past (completed) visit and one upcoming.
-- ---------------------------------------------------------------------
INSERT INTO appointments (patient_id, doctor_id, appt_date, appt_time, amount_paid, booked_at) VALUES
  (5, 2, DATE_SUB(CURDATE(), INTERVAL 10 DAY), '10:00:00', 100.00, DATE_SUB(NOW(), INTERVAL 20 DAY)),
  (1, 2, DATE_ADD(CURDATE(), INTERVAL 5 DAY),  '10:00:00', 100.00, DATE_SUB(NOW(), INTERVAL 1 DAY));

-- ---------------------------------------------------------------------
-- Dr. Larbi (id 3): two upcoming, one cancelled with 50% refund.
-- ---------------------------------------------------------------------
INSERT INTO appointments (patient_id, doctor_id, appt_date, appt_time, amount_paid, booked_at) VALUES
  (4, 3, DATE_ADD(CURDATE(), INTERVAL 1 DAY), '15:00:00', 250.00, DATE_SUB(NOW(), INTERVAL 3 DAY)),
  (3, 3, DATE_ADD(CURDATE(), INTERVAL 2 DAY), '09:30:00', 250.00, DATE_SUB(NOW(), INTERVAL 3 DAY));

INSERT INTO appointments
  (patient_id, doctor_id, appt_date, appt_time, status, amount_paid, booked_at, cancelled_at, refund_percent, refund_amount)
VALUES
  (2, 3, DATE_SUB(CURDATE(), INTERVAL 2 DAY), '11:00:00', 'CANCELLED', 250.00,
   DATE_SUB(NOW(), INTERVAL 7 DAY),
   -- cancelled 30 hours before the appointment -> 24–48h tier -> 50%
   DATE_SUB(TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '11:00:00'), INTERVAL 30 HOUR),
   50, 125.00);
