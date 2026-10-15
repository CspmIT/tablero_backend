-- Tickets desde Más Agua (15/10): mismo circuito que Reconecta
-- (routes/integracionTickets.js). ADITIVA: suma el valor al enum de origen.
ALTER TABLE `Ticket` MODIFY `origen` ENUM('manual','whatsapp','mesa_ayuda','reconecta','masagua') NOT NULL DEFAULT 'manual';
