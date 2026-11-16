terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Dynamic AMI lookup for Ubuntu 22.04 LTS (Jammy) across any AWS region
data "aws_ami" "ubuntu" {
  most_recent = true
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
  owners = ["099720109477"] # Canonical
}

# User-provided public SSH key for key-pair creation (private key remains on local host)
resource "aws_key_pair" "civichelp_key" {
  count      = var.public_key != "" ? 1 : 0
  key_name   = var.key_name
  public_key = var.public_key
}

# Security Group: HTTP (80) open, SSH (22) restricted to admin CIDR, Port 5001 NOT exposed publicly
resource "aws_security_group" "civichelp_sg" {
  name        = "civichelp-sg"
  description = "CivicHelp Security Group - HTTP and restricted SSH"

  # SSH ingress (port 22) restricted to configurable admin CIDR
  ingress {
    description = "SSH administrative access"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  # HTTP ingress (port 80) open to public for Nginx reverse proxy
  ingress {
    description = "HTTP web traffic via Nginx"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # NOTE: Backend port 5001 is deliberately NOT exposed to the public internet.
  # Traffic reaches the backend internally through the Nginx reverse proxy on port 80.

  # All outbound traffic allowed
  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "civichelp-sg"
  }
}

# EC2 Instance - Economical single-node deployment for AWS Academy Learner Lab
resource "aws_instance" "civichelp_server" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  key_name                    = var.public_key != "" ? aws_key_pair.civichelp_key[0].key_name : var.key_name
  vpc_security_group_ids      = [aws_security_group.civichelp_sg.id]
  associate_public_ip_address = true

  root_block_device {
    volume_size           = 20
    volume_type           = "gp3"
    delete_on_termination = true
  }

  tags = {
    Name = "civichelp-server"
  }
}
