output "ec2_public_ip" {
  description = "Public IP address of CivicHelp EC2 instance"
  value       = aws_instance.civichelp_server.public_ip
}

output "ec2_public_dns" {
  description = "Public DNS hostname of CivicHelp EC2 instance"
  value       = aws_instance.civichelp_server.public_dns
}

output "ssh_connection_string" {
  description = "SSH connection string for connecting to the instance"
  value       = "ssh -i ~/.ssh/${var.key_name} ubuntu@${aws_instance.civichelp_server.public_ip}"
}

output "application_url" {
  description = "Direct HTTP URL to access CivicHelp in browser"
  value       = "http://${aws_instance.civichelp_server.public_ip}"
}
