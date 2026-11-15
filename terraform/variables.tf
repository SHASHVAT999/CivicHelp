variable "aws_region" {
  type        = string
  description = "AWS region for deployment (e.g. us-east-1 for AWS Academy Learner Lab or ap-south-1)"
  default     = "us-east-1"
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type (economical instance within AWS Academy budget)"
  default     = "t3.micro"
}

variable "key_name" {
  type        = string
  description = "Name of the AWS key pair for SSH access"
  default     = "civichelp-key"
}

variable "public_key" {
  type        = string
  description = "User-provided public SSH key material (e.g. contents of ~/.ssh/civichelp-key.pub). The corresponding private key stays on the local machine."
  default     = ""
}

variable "admin_cidr" {
  type        = string
  description = "Administrator IPv4 CIDR block permitted for SSH access (port 22). Must be restricted (e.g. 203.0.113.50/32). Wide-open 0.0.0.0/0 is strictly prohibited."

  validation {
    condition     = var.admin_cidr != null && var.admin_cidr != "" && var.admin_cidr != "0.0.0.0/0" && can(cidrhost(var.admin_cidr, 0))
    error_message = "The admin_cidr variable must be a valid CIDR block and cannot be wide-open '0.0.0.0/0'. Restrict SSH to your administrator IP address (e.g. 203.0.113.50/32)."
  }
}

variable "db_password" {
  type        = string
  description = "Database root password (sensitive, must be provided at deployment time)"
  sensitive   = true
  default     = null
}

variable "jwt_secret" {
  type        = string
  description = "JWT secret key for token signing (sensitive, must be provided at deployment time)"
  sensitive   = true
  default     = null
}
