#!/usr/bin/env bash
# Multiplayer server on EC2, reached at wss://mp.imjin1592.com/ws.
#   scripts/deploy-mp.sh check    read-only preflight: AWS CLI v2, login, bucket, role, hosted zone, VPC (run this first)
#   scripts/deploy-mp.sh setup    one time: security group (80/443 only), t4g.small with the instance role and
#                                 infra/mp-user-data.sh, Elastic IP, Route 53 record for mp.imjin1592.com
#   scripts/deploy-mp.sh deploy   build server/dist/server.cjs, upload it, restart the service through SSM
#   scripts/deploy-mp.sh ci       let the GitHub deploy role do the same on every push (repository variable
#                                 MP_INSTANCE_ID must then be set to the instance id)
#   scripts/deploy-mp.sh status   instance state and health check
# Already in place: private bucket imjin1592-deploy, role and instance profile imjin-mp-instance (SSM core + read
# of s3://imjin1592-deploy/server/*). There is no SSH key or port; use `aws ssm start-session` for a shell.
# Needs AWS CLI v2 and a login (`aws login`, or `aws configure sso`; AWS_PROFILE picks a named one). Works with the
# bash 3.2 and BSD tools macOS ships.
set -euo pipefail
# Both spellings, as CLI versions differ; no pager, so `aws` never waits for a key press in a terminal.
export AWS_REGION=ap-northeast-2 AWS_DEFAULT_REGION=ap-northeast-2 AWS_PAGER="" MSYS_NO_PATHCONV=1
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ZONE=Z0649700MFCE82BHO7X1
HOST=mp.imjin1592.com
VPC=vpc-01dc516a
GITHUB_ROLE=imjin1592-github-deploy

die() {
  echo "error: $*" >&2
  exit 1
}

instance_id() {
  aws ec2 describe-instances --filters Name=tag:Name,Values=imjin-mp Name=instance-state-name,Values=pending,running \
    --query 'Reservations[0].Instances[0].InstanceId' --output text
}

case "${1:-}" in
  check)
    command -v aws >/dev/null || die "aws CLI not found; install AWS CLI v2 (brew install awscli)"
    VERSION=$(aws --version 2>&1 | sed -n 's#^aws-cli/\([0-9]*\).*#\1#p')
    [ "$VERSION" = "2" ] || die "AWS CLI v2 is needed, found: $(aws --version 2>&1)"
    CALLER=$(aws sts get-caller-identity --query Arn --output text) || die "not logged in; run: aws login"
    echo "caller:        $CALLER"
    aws s3api head-bucket --bucket imjin1592-deploy && echo "bucket:        imjin1592-deploy ok"
    aws iam get-instance-profile --instance-profile-name imjin-mp-instance --query InstanceProfile.InstanceProfileName --output text | sed 's/^/instance profile: /'
    aws route53 get-hosted-zone --id $ZONE --query HostedZone.Name --output text | sed 's/^/hosted zone:   /'
    aws ec2 describe-vpcs --vpc-ids $VPC --query 'Vpcs[0].VpcId' --output text | sed 's/^/vpc:           /'
    echo "instance:      $(instance_id) (None means setup has not run yet)"
    ;;
  setup)
    SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=imjin-mp --query 'SecurityGroups[0].GroupId' --output text)
    if [ "$SG" = "None" ]; then
      SG=$(aws ec2 create-security-group --group-name imjin-mp --description "Imjin multiplayer server" --vpc-id $VPC --query GroupId --output text)
      aws ec2 authorize-security-group-ingress --group-id "$SG" --ip-permissions \
        'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' \
        'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' >/dev/null
    fi
    AMI=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text)
    ID=$(instance_id)
    if [ "$ID" = "None" ]; then
      ( cd "$ROOT" && npm run server:build >/dev/null )
      aws s3 cp "$ROOT/server/dist/server.cjs" s3://imjin1592-deploy/server/server.cjs --only-show-errors
      ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type t4g.small --security-group-ids "$SG" \
        --iam-instance-profile Name=imjin-mp-instance --user-data "file://$ROOT/infra/mp-user-data.sh" \
        --metadata-options HttpTokens=required \
        --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=imjin-mp}]' \
        --query 'Instances[0].InstanceId' --output text)
      aws ec2 wait instance-running --instance-ids "$ID"
    fi
    IP=$(aws ec2 describe-addresses --filters Name=tag:Name,Values=imjin-mp --query 'Addresses[0].PublicIp' --output text)
    if [ "$IP" = "None" ]; then
      ALLOC=$(aws ec2 allocate-address --domain vpc --tag-specifications 'ResourceType=elastic-ip,Tags=[{Key=Name,Value=imjin-mp}]' --query AllocationId --output text)
      aws ec2 associate-address --instance-id "$ID" --allocation-id "$ALLOC" >/dev/null
      IP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)
    fi
    aws route53 change-resource-record-sets --hosted-zone-id $ZONE --change-batch \
      "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$HOST\",\"Type\":\"A\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"$IP\"}]}}]}" >/dev/null
    echo "instance $ID at $IP, $HOST points there. Caddy fetches its certificate once DNS resolves (a few minutes)."
    ;;
  deploy)
    ( cd "$ROOT" && npm run server:build >/dev/null )
    aws s3 cp "$ROOT/server/dist/server.cjs" s3://imjin1592-deploy/server/server.cjs --only-show-errors
    ID=$(instance_id)
    [ "$ID" != "None" ] || die "no running imjin-mp instance; run setup first"
    CMD=$(aws ssm send-command --instance-ids "$ID" --document-name AWS-RunShellScript --parameters 'commands=["/usr/local/bin/imjin-deploy"]' --query Command.CommandId --output text)
    aws ssm wait command-executed --command-id "$CMD" --instance-id "$ID" || true
    aws ssm get-command-invocation --command-id "$CMD" --instance-id "$ID" --query '[Status,StandardErrorContent]' --output text
    ;;
  ci)
    ID=$(instance_id)
    POLICY=$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["s3:PutObject"],"Resource":"arn:aws:s3:::imjin1592-deploy/server/*"},
 {"Effect":"Allow","Action":["ssm:SendCommand"],"Resource":["arn:aws:ec2:$AWS_REGION:*:instance/$ID","arn:aws:ssm:$AWS_REGION::document/AWS-RunShellScript"]},
 {"Effect":"Allow","Action":["ssm:GetCommandInvocation"],"Resource":"*"}
]}
JSON
)
    aws iam put-role-policy --role-name $GITHUB_ROLE --policy-name mp-deploy --policy-document "$POLICY"
    echo "set the repository variable MP_INSTANCE_ID=$ID so the deploy workflow updates the server"
    ;;
  status)
    ID=$(instance_id)
    echo "instance: $ID"
    [ "$ID" = "None" ] || aws ec2 describe-instances --instance-ids "$ID" --query 'Reservations[0].Instances[0].[State.Name,PublicIpAddress]' --output text
    curl -fsS --max-time 10 "https://$HOST/health" && echo
    ;;
  *)
    sed -n '2,17p' "$0"
    exit 1
    ;;
esac
